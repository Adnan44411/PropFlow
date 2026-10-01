import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { QueryTypes } from 'sequelize';
import { config } from '../config';
import { sequelize } from '../lib/db';
import { Errors } from '../lib/errors';
import { redis } from '../lib/redis';
import { userNameMap } from './identity.service';
import { getMasterMaps } from './masterData.service';

dayjs.extend(utc);
dayjs.extend(timezone);

const keysSet = (tenantId: number) => `dash:${tenantId}:keys`;

/** Called after any property write so the 60 s cache never shows a stale number after an edit. */
export async function invalidateDashboard(tenantId: number): Promise<void> {
  try {
    const keys = await redis.smembers(keysSet(tenantId));
    if (keys.length) await redis.del(...keys);
    await redis.del(keysSet(tenantId));
  } catch {
    /* cache only */
  }
}

function offsetOf(tz: string, at: string): string {
  try {
    return dayjs.tz(at, tz).format('Z'); // e.g. +05:30
  } catch {
    throw Errors.validation({ fields: { tz: 'Unknown time zone' } });
  }
}

/**
 * GET /dashboard?from&to&tz — one call feeds 4 KPI cards and 4 charts.
 * Days are bucketed in the caller's time zone. Cached 60 s per tenant+range (`dash:{tenantId}:{from}:{to}`).
 */
export async function getDashboard(tenantId: number, q: { from: string; to: string; tz: string }) {
  if (dayjs(q.to).diff(dayjs(q.from), 'day') > 800) throw Errors.validation({ fields: { from: 'Range is limited to ~2 years' } });
  const cacheKey = `dash:${tenantId}:${q.from}:${q.to}${q.tz === 'Asia/Kolkata' ? '' : `:${q.tz}`}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return { ...JSON.parse(cached), cached: true };

  const offset = offsetOf(q.tz, q.from);
  const start = dayjs.tz(q.from, q.tz).startOf('day').utc().toDate();
  const end = dayjs.tz(q.to, q.tz).endOf('day').utc().toDate();
  const repl = { tenantId, start, end, offset };
  const run = <T extends object>(sql: string) => sequelize.query<T>(sql, { replacements: repl, type: QueryTypes.SELECT });

  const [kpi, perDay, byStatus, byType, leaders, maps, users] = await Promise.all([
    run<{ newListings: number; activeListings: number; closedDeals: number; closedValue: string | number; avgPricePerSqft: number | null }>(`
      SELECT
        SUM(p.created_at BETWEEN :start AND :end)                                     AS newListings,
        SUM(s.stage = 'OPEN')                                                          AS activeListings,
        SUM(s.stage = 'WON' AND p.closed_at BETWEEN :start AND :end)                   AS closedDeals,
        COALESCE(SUM(CASE WHEN s.stage = 'WON' AND p.closed_at BETWEEN :start AND :end THEN p.price_inr END), 0) AS closedValue,
        ROUND(AVG(CASE WHEN p.created_at BETWEEN :start AND :end AND p.listing_type = 'SALE' THEN p.price_inr / NULLIF(p.carpet_area_sqft,0) END)) AS avgPricePerSqft
      FROM properties p JOIN property_statuses s ON s.id = p.status_id
      WHERE p.tenant_id = :tenantId AND p.deleted_at IS NULL`),
    run<{ day: string; total: number; sale: number; rent: number }>(`
      SELECT DATE_FORMAT(CONVERT_TZ(p.created_at, '+00:00', :offset), '%Y-%m-%d') AS day,
             COUNT(*) AS total, SUM(p.listing_type = 'SALE') AS sale, SUM(p.listing_type = 'RENT') AS rent
      FROM properties p
      WHERE p.tenant_id = :tenantId AND p.deleted_at IS NULL AND p.created_at BETWEEN :start AND :end
      GROUP BY day ORDER BY day`),
    run<{ statusId: number; count: number }>(`
      SELECT p.status_id AS statusId, COUNT(*) AS count
      FROM properties p
      WHERE p.tenant_id = :tenantId AND p.deleted_at IS NULL AND p.created_at BETWEEN :start AND :end
      GROUP BY p.status_id`),
    run<{ typeId: number; count: number; value: string | number }>(`
      SELECT p.type_id AS typeId, COUNT(*) AS count, COALESCE(SUM(p.price_inr),0) AS value
      FROM properties p
      WHERE p.tenant_id = :tenantId AND p.deleted_at IS NULL AND p.created_at BETWEEN :start AND :end
      GROUP BY p.type_id ORDER BY count DESC`),
    run<{ agentId: number; closedCount: number; closedValue: string | number }>(`
      SELECT p.assignee_id AS agentId, COUNT(*) AS closedCount, SUM(p.price_inr) AS closedValue
      FROM properties p JOIN property_statuses s ON s.id = p.status_id
      WHERE p.tenant_id = :tenantId AND p.deleted_at IS NULL AND s.stage = 'WON'
        AND p.closed_at BETWEEN :start AND :end AND p.assignee_id IS NOT NULL
      GROUP BY p.assignee_id ORDER BY closedValue DESC LIMIT 5`),
    getMasterMaps(tenantId),
    userNameMap(tenantId),
  ]);

  // Fill missing days with zeros so the line chart is continuous.
  const byDay = new Map(perDay.map((r) => [r.day, r]));
  const listingsOverTime: Array<{ date: string; total: number; sale: number; rent: number }> = [];
  for (let d = dayjs(q.from); !d.isAfter(dayjs(q.to)); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    const r = byDay.get(key);
    listingsOverTime.push({ date: key, total: Number(r?.total ?? 0), sale: Number(r?.sale ?? 0), rent: Number(r?.rent ?? 0) });
  }

  // Funnel: statuses in pipeline order. `count` = currently at that stage; `reached` = at or beyond it
  // (Closed counts as having passed every open stage; Withdrawn is reported separately).
  const statuses = [...maps.statuses.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const counts = new Map(byStatus.map((r) => [Number(r.statusId), Number(r.count)]));
  const pipeline = statuses.filter((s) => s.stage !== 'LOST');
  const funnel = pipeline.map((s, i) => ({
    statusId: s.id,
    name: s.name,
    stage: s.stage,
    count: counts.get(s.id) ?? 0,
    reached: pipeline.slice(i).reduce((sum, x) => sum + (counts.get(x.id) ?? 0), 0),
  }));
  const lost = statuses.filter((s) => s.stage === 'LOST').map((s) => ({ statusId: s.id, name: s.name, count: counts.get(s.id) ?? 0 }));

  const k = kpi[0];
  const result = {
    range: { from: q.from, to: q.to, tz: q.tz },
    kpis: {
      newListings: Number(k?.newListings ?? 0),
      activeListings: Number(k?.activeListings ?? 0),
      closedDeals: Number(k?.closedDeals ?? 0),
      closedValue: Number(k?.closedValue ?? 0),
      avgPricePerSqft: k?.avgPricePerSqft != null ? Number(k.avgPricePerSqft) : null,
    },
    listingsOverTime,
    funnel,
    lost,
    typeSplit: byType.map((r) => ({
      typeId: Number(r.typeId),
      name: maps.types.get(Number(r.typeId))?.name ?? null,
      count: Number(r.count),
      value: Number(r.value),
    })),
    topAgents: leaders.map((r) => ({
      agentId: Number(r.agentId),
      name: users.get(Number(r.agentId)) ?? null,
      closedCount: Number(r.closedCount),
      closedValue: Number(r.closedValue),
    })),
    isEmpty: Number(k?.newListings ?? 0) === 0 && Number(k?.closedDeals ?? 0) === 0,
    generatedAt: new Date().toISOString(),
  };
  await redis
    .multi()
    .set(cacheKey, JSON.stringify(result), 'EX', config.DASHBOARD_CACHE_SECONDS)
    .sadd(keysSet(tenantId), cacheKey)
    .expire(keysSet(tenantId), config.DASHBOARD_CACHE_SECONDS * 2)
    .exec()
    .catch(() => undefined);
  return { ...result, cached: false };
}
