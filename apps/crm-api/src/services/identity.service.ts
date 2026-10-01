import { EVENTS_CHANNEL, PlatformEvent } from '@propflow/shared';
import type Redis from 'ioredis';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { createRedis } from '../lib/redis';
import { TenantMirror, UserMirror } from '../models';
import type { AuthContext } from './token';
import { ensureTenantDefaults } from './masterData.service';

/**
 * crm-api does not share auth_db. It keeps a small read-only mirror of tenants/users
 * (names for assignee columns, leaderboard, chat) fed by:
 *   1. Redis pub/sub events published by auth-server (tenant.created, user.upserted);
 *   2. a lazy upsert from token claims the first time a user is seen (covers missed events).
 */
const seen = new Map<number, number>();
const SEEN_TTL_MS = 5 * 60_000;

export async function touchFromToken(auth: AuthContext): Promise<void> {
  const last = seen.get(auth.userId);
  if (last && Date.now() - last < SEEN_TTL_MS) return;
  seen.set(auth.userId, Date.now());
  if (auth.tenantId) {
    await TenantMirror.findOrCreate({ where: { id: auth.tenantId }, defaults: { id: auth.tenantId, name: `Tenant ${auth.tenantId}`, slug: null } });
    await ensureTenantDefaults(auth.tenantId);
  }
  const existing = await UserMirror.findByPk(auth.userId);
  if (!existing) {
    await UserMirror.create({
      id: auth.userId,
      tenantId: auth.tenantId,
      name: auth.name ?? `User ${auth.userId}`,
      email: null,
      role: auth.role,
      isActive: true,
    });
  } else if (existing.role !== auth.role || (auth.name && existing.name !== auth.name)) {
    await existing.update({ role: auth.role, name: auth.name ?? existing.name });
  }
}

export async function applyEvent(event: PlatformEvent): Promise<void> {
  if (event.type === 'tenant.created') {
    await TenantMirror.upsert({ id: event.tenant.id, name: event.tenant.name, slug: event.tenant.slug });
    await ensureTenantDefaults(event.tenant.id);
  } else if (event.type === 'user.upserted') {
    const u = event.user;
    await UserMirror.upsert({ id: u.id, tenantId: u.tenantId, name: u.name, email: u.email, role: u.role as UserMirror['role'], isActive: u.isActive });
    seen.delete(u.id);
  }
}

let subscriber: Redis | null = null;

export async function startIdentitySubscriber(): Promise<void> {
  subscriber = createRedis('events-sub');
  await subscriber.subscribe(EVENTS_CHANNEL);
  subscriber.on('message', (_channel, raw) => {
    let event: PlatformEvent;
    try {
      event = JSON.parse(raw) as PlatformEvent;
    } catch {
      return;
    }
    applyEvent(event).catch((err) => logger.error('failed to apply platform event', { type: event.type, err }));
  });
  logger.info('identity subscriber started', { channel: EVENTS_CHANNEL });
}

export async function stopIdentitySubscriber(): Promise<void> {
  if (subscriber) await subscriber.quit().catch(() => undefined);
  subscriber = null;
}

/** id → name for the whole tenant (for list/export serialisation). */
export async function userNameMap(tenantId: number): Promise<Map<number, string>> {
  const rows = await UserMirror.findAll({ where: { tenantId }, attributes: ['id', 'name'], raw: true });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function assertAssignableUser(tenantId: number, userId: number): Promise<UserMirror> {
  const user = await UserMirror.findOne({ where: { id: userId, tenantId, isActive: true } });
  if (!user || !['AGENT', 'MANAGER', 'ADMIN'].includes(user.role)) {
    throw Errors.rule('BUSINESS_RULE', 'Assignee must be an active user of this agency', { fields: { assigneeId: 'Choose an active agent' } });
  }
  return user;
}
