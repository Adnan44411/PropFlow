import crypto from 'node:crypto';
import cron, { ScheduledTask } from 'node-cron';
import { Op, QueryTypes } from 'sequelize';
import { SOCKET_EVENTS } from '@propflow/shared';
import { config } from '../config';
import { sequelize } from '../lib/db';
import { logger } from '../lib/logger';
import { emitToUser } from '../lib/realtime';
import { requestContext } from '../lib/requestContext';
import { Property, SiteVisit } from '../models';
import { acquireJobLock } from './lock';

function run(job: string, fn: () => Promise<Record<string, unknown>>) {
  return async () => {
    const requestId = `cron-${job}-${crypto.randomBytes(4).toString('hex')}`;
    await requestContext.run({ requestId }, async () => {
      try {
        if (!(await acquireJobLock(job))) {
          logger.debug('cron lock held elsewhere, skipping', { job });
          return;
        }
        const started = Date.now();
        const result = await fn();
        logger.info('cron job finished', { job, ms: Date.now() - started, instance: config.INSTANCE_ID, ...result });
      } catch (err) {
        logger.error('cron job failed', { job, err });
      }
    });
  };
}

/**
 * Every minute: visits starting within the next 15 min, not yet reminded → emit visit:reminder
 * to the agent and set reminded_at. The conditional UPDATE (reminded_at IS NULL) guarantees
 * exactly-once even if two instances ever raced past the lock.
 */
export async function sendVisitReminders(now = new Date()): Promise<{ reminded: number }> {
  const horizon = new Date(now.getTime() + config.REMINDER_LEAD_MINUTES * 60_000);
  const due = await SiteVisit.findAll({
    where: { remindedAt: null, outcome: 'SCHEDULED', visitAtUtc: { [Op.between]: [now, horizon] } },
    include: [{ model: Property, as: 'property', attributes: ['id', 'title', 'buildingName', 'unitNo'] }],
    limit: 500,
  });
  let reminded = 0;
  for (const v of due) {
    const [affected] = await SiteVisit.update({ remindedAt: now }, { where: { id: v.id, remindedAt: null } });
    if (affected !== 1) continue;
    reminded++;
    const visitAt = new Date(v.visitAtUtc);
    emitToUser(v.agentId, SOCKET_EVENTS.visitReminder, {
      visitId: Number(v.id),
      propertyId: Number(v.propertyId),
      propertyTitle: v.property?.title ?? null,
      building: v.property ? `${v.property.buildingName} ${v.property.unitNo}` : null,
      visitAt: visitAt.toISOString(),
      minutesUntil: Math.max(0, Math.round((visitAt.getTime() - now.getTime()) / 60_000)),
      visitorName: v.visitorName,
    });
  }
  return { reminded };
}

/** Nightly 02:00 IST: open listings with no activity for 30 days are tagged stale. */
export async function tagStaleListings(): Promise<{ tagged: number }> {
  const [, meta] = await sequelize.query(
    `UPDATE properties p
       JOIN property_statuses s ON s.id = p.status_id
        SET p.is_stale = 1
      WHERE p.deleted_at IS NULL AND p.is_stale = 0 AND s.stage = 'OPEN'
        AND p.last_activity_at < (UTC_TIMESTAMP() - INTERVAL :days DAY)`,
    { replacements: { days: config.STALE_AFTER_DAYS }, type: QueryTypes.UPDATE },
  );
  return { tagged: Number(meta ?? 0) };
}

let tasks: ScheduledTask[] = [];

export function startJobs(): void {
  if (!config.CRON_ENABLED) return;
  tasks = [
    cron.schedule('* * * * *', run('visit-reminders', sendVisitReminders), { timezone: 'UTC' }),
    cron.schedule('0 2 * * *', run('stale-listings', tagStaleListings), { timezone: config.CRON_TZ }),
  ];
  logger.info('cron jobs scheduled', { jobs: ['visit-reminders (every minute)', `stale-listings (02:00 ${config.CRON_TZ})`] });
}

export function stopJobs(): void {
  for (const t of tasks) t.stop();
  tasks = [];
}
