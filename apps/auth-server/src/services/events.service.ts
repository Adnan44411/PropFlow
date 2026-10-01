import { EVENTS_CHANNEL, PlatformEvent } from '@propflow/shared';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import type { Tenant, User } from '../models';

/** Fire-and-forget notifications to crm-api (it mirrors tenants/users for names & assignment). */
async function publish(event: PlatformEvent): Promise<void> {
  try {
    await redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.error('failed to publish platform event', { type: event.type, err });
  }
}

export const publishTenantCreated = (t: Tenant) => publish({ type: 'tenant.created', tenant: { id: t.id, name: t.name, slug: t.slug } });

export const publishUserUpserted = (u: User) =>
  publish({
    type: 'user.upserted',
    user: { id: u.id, tenantId: u.tenantId ?? null, name: u.name, email: u.email, role: u.role, isActive: u.isActive },
  });
