import { Op } from 'sequelize';
import type { UpdateUserInput } from '@propflow/shared';
import { sequelize } from '../lib/db';
import { Errors } from '../lib/errors';
import { User } from '../models';
import { publishUserUpserted } from './events.service';
import { refreshStore } from './refresh.service';
import { recordSecurityEvent } from './securityEvents.service';

export async function listUsers(tenantId: number, q?: { role?: string; search?: string; includeInactive?: boolean }) {
  const where: Record<string | symbol, unknown> = { tenantId };
  if (q?.role) where.role = q.role;
  if (!q?.includeInactive) where.isActive = true;
  if (q?.search) {
    const like = `%${q.search.replace(/[%_]/g, '\\$&')}%`;
    where[Op.or] = [{ name: { [Op.like]: like } }, { email: { [Op.like]: like } }];
  }
  const users = await User.findAll({ where, order: [['name', 'ASC']] });
  return users.map((u) => u.toPublic());
}

export async function getUser(tenantId: number, id: number) {
  const user = await User.findOne({ where: { id, tenantId } });
  if (!user) throw Errors.notFound('User');
  return user.toPublic();
}

/**
 * PATCH /users/:id — role change / deactivate / rename.
 * Guard: the last active ADMIN of a tenant can be neither demoted nor deactivated (422 LAST_ADMIN).
 * Admin rows are locked FOR UPDATE so two concurrent demotions cannot both pass the check.
 */
export async function updateUser(tenantId: number, id: number, input: UpdateUserInput, actor: { id: number; ip: string }) {
  const user = await sequelize.transaction(async (transaction) => {
    const target = await User.findOne({ where: { id, tenantId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!target) throw Errors.notFound('User');
    const losesAdmin = target.role === 'ADMIN' && target.isActive && ((input.role && input.role !== 'ADMIN') || input.isActive === false);
    if (losesAdmin) {
      const admins = await User.findAll({
        where: { tenantId, role: 'ADMIN', isActive: true },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (admins.length <= 1) {
        throw Errors.rule('LAST_ADMIN', 'The last active admin cannot be demoted or deactivated', {
          fields: { [input.isActive === false ? 'isActive' : 'role']: 'At least one active admin is required' },
        });
      }
    }
    if (input.role) target.role = input.role;
    if (input.name) target.name = input.name;
    if (input.isActive !== undefined) target.isActive = input.isActive;
    await target.save({ transaction });
    return target;
  });
  // Role/active changes take effect at the next refresh (≤ access TTL); deactivation kills sessions now.
  if (input.isActive === false || input.role) await refreshStore.revokeAllForUser(user.id);
  await recordSecurityEvent({ type: 'USER_UPDATED', userId: actor.id, tenantId, ip: actor.ip, meta: { targetUserId: id, changes: input } });
  await publishUserUpserted(user);
  return user.toPublic();
}

export async function countAll() {
  return User.count({ where: { tenantId: { [Op.ne]: null } } });
}
