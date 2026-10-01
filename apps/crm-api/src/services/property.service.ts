import type { BulkActionInput, PropertyCreateInput, PropertyListQuery, PropertyUpdateInput } from '@propflow/shared';
import { SOCKET_EVENTS } from '@propflow/shared';
import { CreationAttributes, Op, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../lib/db';
import { AppError, Errors } from '../lib/errors';
import { inrShort, maskPhone } from '../lib/format';
import { emitPropertyUpdated, emitToProperty, revokePropertyRoom } from '../lib/realtime';
import { currentRequestId } from '../lib/requestContext';
import { Actor, isStaff, propertyScope } from '../middleware/auth';
import { ChatMessage, Property, PropertyActivity, PropertyAmenity, PropertyNote, UserMirror } from '../models';
import { invalidateDashboard } from './dashboard.service';
import { assertAssignableUser, userNameMap } from './identity.service';
import { defaultStatus, getMasterMaps, MasterMaps } from './masterData.service';
import { buildOrder, buildPropertyWhere } from './propertyQuery';
import { PropertyRow, serializeProperty } from './serializers';

async function ctxFor(actor: Actor) {
  const [maps, users] = await Promise.all([getMasterMaps(actor.tenantId), userNameMap(actor.tenantId)]);
  return { actor, maps, users };
}

// ─────────────────────────────── List ───────────────────────────────

export async function listProperties(actor: Actor, q: PropertyListQuery) {
  const maps = await getMasterMaps(actor.tenantId);
  const where = buildPropertyWhere(actor, q, maps);
  const [total, rows, users] = await Promise.all([
    Property.count({ where }),
    Property.findAll({
      where,
      order: buildOrder(q.sortBy, q.sortOrder),
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
      raw: true,
    }),
    userNameMap(actor.tenantId),
  ]);
  const ctx = { actor, maps, users };
  return {
    data: (rows as unknown as PropertyRow[]).map((r) => serializeProperty(r, ctx)),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
  };
}

// ─────────────────────────────── Read ───────────────────────────────

/** 404 for another tenant's id AND for an agent's non-assigned id (never 403: that leaks existence). */
export async function findScoped(actor: Actor, id: number, transaction?: Transaction, lock = false): Promise<Property> {
  const p = await Property.findOne({
    where: { ...propertyScope(actor), id },
    transaction,
    lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!p) throw Errors.notFound('Property');
  return p;
}

export async function canReadProperty(actor: Actor, id: number): Promise<boolean> {
  return (await Property.count({ where: { ...propertyScope(actor), id } })) > 0;
}

async function amenityIdsOf(propertyId: number, transaction?: Transaction): Promise<number[]> {
  const rows = await PropertyAmenity.findAll({ where: { propertyId }, attributes: ['amenityId'], raw: true, transaction });
  return rows.map((r) => r.amenityId).sort((a, b) => a - b);
}

export async function getProperty(actor: Actor, id: number) {
  const p = await findScoped(actor, id);
  const ctx = await ctxFor(actor);
  return serializeProperty(p.get({ plain: true }) as PropertyRow, ctx, { amenityIds: await amenityIdsOf(p.id) });
}

// ─────────────────────────────── Validation helpers ───────────────────────────────

function assertMaster(maps: MasterMaps, input: Partial<PropertyCreateInput>) {
  const fields: Record<string, string> = {};
  const check = (key: keyof MasterMaps, id: number | undefined, field: string, label: string) => {
    if (id == null) return;
    const item = maps[key].get(id);
    if (!item || !item.isActive) fields[field] = `Unknown or inactive ${label}`;
  };
  check('types', input.typeId, 'typeId', 'property type');
  check('localities', input.localityId, 'localityId', 'locality');
  check('statuses', input.statusId, 'statusId', 'status');
  for (const a of input.amenityIds ?? []) if (!maps.amenities.get(a)?.isActive) fields.amenityIds = 'Unknown or inactive amenity';
  if (Object.keys(fields).length) throw Errors.validation({ fields });
}

function duplicateError(actor: Actor, existingId?: number) {
  return new AppError(409, 'DUPLICATE_LISTING', 'A listing with this building and unit already exists', {
    fields: { unitNo: 'This unit is already listed in this building' },
    ...(isStaff(actor) && existingId ? { existingId } : {}),
  });
}

export async function checkDuplicate(actor: Actor, buildingName: string, unitNo: string, excludeId?: number) {
  const existing = await Property.findOne({
    where: { tenantId: actor.tenantId, buildingName, unitNo, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    attributes: ['id', 'assigneeId'],
  });
  return {
    duplicate: !!existing,
    ...(existing && (isStaff(actor) || existing.assigneeId === actor.userId) ? { existingId: existing.id } : {}),
  };
}

// ─────────────────────────────── Create ───────────────────────────────

export async function createProperty(actor: Actor, input: PropertyCreateInput) {
  const maps = await getMasterMaps(actor.tenantId);
  assertMaster(maps, input);
  let assigneeId: number | null;
  if (actor.role === 'AGENT') {
    if (input.assigneeId && input.assigneeId !== actor.userId) throw Errors.forbiddenRole('Agents cannot assign listings to others');
    assigneeId = actor.userId;
  } else {
    assigneeId = input.assigneeId ?? null;
    if (assigneeId) await assertAssignableUser(actor.tenantId, assigneeId);
  }
  const status = input.statusId ? maps.statuses.get(input.statusId)! : defaultStatus(maps);
  if (!status) throw Errors.rule('BUSINESS_RULE', 'No active status configured for this agency');

  const now = new Date();
  let created: Property;
  try {
    created = await sequelize.transaction(async (transaction) => {
      const p = await Property.create(
        {
          tenantId: actor.tenantId,
          title: input.title,
          typeId: input.typeId,
          statusId: status.id,
          listingType: input.listingType,
          bhk: input.bhk,
          furnishing: input.furnishing,
          carpetAreaSqft: input.carpetAreaSqft,
          priceInr: input.priceInr,
          listedPriceInr: input.priceInr,
          buildingName: input.buildingName,
          unitNo: input.unitNo,
          floor: input.floor ?? null,
          totalFloors: input.totalFloors ?? null,
          localityId: input.localityId,
          city: input.city,
          address: input.address ?? null,
          ownerName: input.ownerName,
          ownerPhone: input.ownerPhone,
          assigneeId,
          createdBy: actor.userId,
          lastActivityAt: now,
          closedAt: status.stage === 'WON' ? now : null,
        },
        { transaction },
      );
      if (input.amenityIds?.length) {
        await PropertyAmenity.bulkCreate(
          [...new Set(input.amenityIds)].map((amenityId) => ({ propertyId: p.id, amenityId })),
          { transaction },
        );
      }
      await PropertyActivity.create(
        {
          tenantId: actor.tenantId,
          propertyId: p.id,
          actorId: actor.userId,
          action: 'CREATED',
          summary: `Listed at ${inrShort(input.priceInr)}`,
          diff: null,
          requestId: currentRequestId() ?? null,
        },
        { transaction },
      );
      return p;
    });
  } catch (err) {
    // H7: the unique index decides, so two parallel POSTs give exactly one 201 and one 409.
    if (err instanceof UniqueConstraintError) {
      const dup = await checkDuplicate(actor, input.buildingName, input.unitNo);
      throw duplicateError(actor, dup.existingId);
    }
    throw err;
  }
  await invalidateDashboard(actor.tenantId);
  emitPropertyUpdated(actor.tenantId, { ids: [created.id], action: 'created', version: created.version }, [assigneeId]);
  return getProperty(actor, created.id);
}

// ─────────────────────────────── Update (optimistic locking) ───────────────────────────────

const DIFF_FIELDS = [
  'title',
  'typeId',
  'statusId',
  'listingType',
  'bhk',
  'furnishing',
  'carpetAreaSqft',
  'priceInr',
  'buildingName',
  'unitNo',
  'floor',
  'totalFloors',
  'localityId',
  'city',
  'address',
  'ownerName',
  'ownerPhone',
  'assigneeId',
] as const;

type DiffEntry = { from: unknown; to: unknown; fromLabel?: string | null; toLabel?: string | null };

function label(field: string, value: unknown, maps: MasterMaps, users: Map<number, string>): string | null {
  if (value == null) return null;
  const n = Number(value);
  switch (field) {
    case 'statusId':
      return maps.statuses.get(n)?.name ?? null;
    case 'typeId':
      return maps.types.get(n)?.name ?? null;
    case 'localityId':
      return maps.localities.get(n)?.name ?? null;
    case 'assigneeId':
      return users.get(n) ?? null;
    case 'priceInr':
      return inrShort(n);
    default:
      return null;
  }
}

function summarize(diff: Record<string, DiffEntry>): string {
  const parts: string[] = [];
  if (diff.statusId) parts.push(`Status: ${diff.statusId.fromLabel ?? diff.statusId.from} → ${diff.statusId.toLabel ?? diff.statusId.to}`);
  if (diff.priceInr) parts.push(`Price: ${diff.priceInr.fromLabel} → ${diff.priceInr.toLabel}`);
  if (diff.assigneeId) parts.push(`Assigned: ${diff.assigneeId.fromLabel ?? 'nobody'} → ${diff.assigneeId.toLabel ?? 'nobody'}`);
  const others = Object.keys(diff).filter((k) => !['statusId', 'priceInr', 'assigneeId'].includes(k));
  if (others.length) parts.push(`Edited ${others.join(', ')}`);
  return parts.join('; ').slice(0, 500);
}

export async function updateProperty(actor: Actor, id: number, input: PropertyUpdateInput) {
  const { maps, users } = await ctxFor(actor);
  assertMaster(maps, input);
  if (input.assigneeId !== undefined && actor.role === 'AGENT' && input.assigneeId !== actor.userId) {
    throw Errors.forbiddenRole('Agents cannot reassign listings');
  }
  if (input.assigneeId) await assertAssignableUser(actor.tenantId, input.assigneeId);

  let result: { property: Property; diff: Record<string, DiffEntry>; oldAssignee: number | null };
  try {
    result = await sequelize.transaction(async (transaction) => {
      const p = await findScoped(actor, id, transaction, true);
      if (p.version !== input.version) {
        const current = serializeProperty(p.get({ plain: true }) as PropertyRow, { actor, maps, users }, { amenityIds: await amenityIdsOf(p.id, transaction) });
        throw new AppError(409, 'VERSION_CONFLICT', 'This listing was changed by someone else since you opened it', {
          yourVersion: input.version,
          currentVersion: p.version,
          current,
        });
      }
      const diff: Record<string, DiffEntry> = {};
      const updates: Record<string, unknown> = {};
      for (const f of DIFF_FIELDS) {
        if (!(f in input) || input[f] === undefined) continue;
        const next = input[f] ?? null;
        const prev = (p.get(f) as unknown) ?? null;
        if (String(prev) === String(next)) continue;
        updates[f] = next;
        diff[f] =
          f === 'ownerPhone'
            ? { from: maskPhone(String(prev)), to: maskPhone(String(next)) }
            : { from: prev, to: next, fromLabel: label(f, prev, maps, users), toLabel: label(f, next, maps, users) };
      }
      if (updates.statusId) {
        const from = maps.statuses.get(p.statusId);
        const to = maps.statuses.get(Number(updates.statusId))!;
        if (from?.isTerminal) {
          throw Errors.rule('TERMINAL_STATUS', `"${from.name}" is a terminal status; the listing can no longer change stage`, {
            fields: { statusId: 'Closed and Withdrawn listings cannot move' },
          });
        }
        updates.closedAt = to.stage === 'WON' ? new Date() : null;
      }
      let amenityIds: number[] | undefined;
      if (input.amenityIds) {
        const before = await amenityIdsOf(p.id, transaction);
        amenityIds = [...new Set(input.amenityIds)].sort((a, b) => a - b);
        if (before.join(',') !== amenityIds.join(',')) {
          diff.amenityIds = { from: before, to: amenityIds };
          await PropertyAmenity.destroy({ where: { propertyId: p.id }, transaction });
          if (amenityIds.length)
            await PropertyAmenity.bulkCreate(
              amenityIds.map((amenityId) => ({ propertyId: p.id, amenityId })),
              { transaction },
            );
        }
      }
      const oldAssignee = p.assigneeId;
      if (Object.keys(diff).length === 0) return { property: p, diff, oldAssignee };

      // version check again in the UPDATE itself (belt and braces with the row lock).
      const [affected] = await Property.update(
        { ...updates, version: p.version + 1, lastActivityAt: new Date(), isStale: false },
        { where: { id: p.id, tenantId: actor.tenantId, version: p.version }, transaction },
      );
      if (affected !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'This listing was changed by someone else', { currentVersion: p.version + 1 });
      await PropertyActivity.create(
        {
          tenantId: actor.tenantId,
          propertyId: p.id,
          actorId: actor.userId,
          action: 'UPDATED',
          summary: summarize(diff),
          diff,
          requestId: currentRequestId() ?? null,
        },
        { transaction },
      );
      await p.reload({ transaction });
      return { property: p, diff, oldAssignee };
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw duplicateError(actor);
    throw err;
  }
  if (Object.keys(result.diff).length) {
    await invalidateDashboard(actor.tenantId);
    emitPropertyUpdated(actor.tenantId, { ids: [id], action: 'updated', version: result.property.version }, [result.oldAssignee, result.property.assigneeId]);
    emitToProperty(id, SOCKET_EVENTS.propertyUpdated, { tenantId: actor.tenantId, ids: [id], action: 'updated', version: result.property.version });
    if (result.diff.assigneeId) await revokeIfAgent(actor.tenantId, [result.oldAssignee], [id]);
  }
  return getProperty(actor, id);
}

// ─────────────────────────────── Delete ───────────────────────────────

export async function deleteProperty(actor: Actor, id: number) {
  const assignee = await sequelize.transaction(async (transaction) => {
    const p = await findScoped(actor, id, transaction, true);
    await PropertyActivity.create(
      {
        tenantId: actor.tenantId,
        propertyId: p.id,
        actorId: actor.userId,
        action: 'DELETED',
        summary: 'Listing deleted',
        diff: null,
        requestId: currentRequestId() ?? null,
      },
      { transaction },
    );
    await p.destroy({ transaction }); // paranoid → sets deleted_at
    return p.assigneeId;
  });
  await invalidateDashboard(actor.tenantId);
  emitPropertyUpdated(actor.tenantId, { ids: [id], action: 'deleted' }, [assignee]);
}

// ─────────────────────────────── Bulk (all-or-nothing) ───────────────────────────────

export async function bulkAction(actor: Actor, input: BulkActionInput) {
  const ids = [...new Set(input.ids)];
  const { maps, users } = await ctxFor(actor);
  if (input.action === 'reassign') await assertAssignableUser(actor.tenantId, input.assigneeId);
  if (input.action === 'changeStatus' && !maps.statuses.get(input.statusId)?.isActive) {
    throw Errors.validation({ fields: { statusId: 'Unknown or inactive status' } });
  }
  if (input.action === 'addAmenity' && !maps.amenities.get(input.amenityId)?.isActive) {
    throw Errors.validation({ fields: { amenityId: 'Unknown or inactive amenity' } });
  }

  const { rows } = await sequelize.transaction(async (transaction) => {
    const rows = await Property.findAll({
      where: { ...propertyScope(actor), id: { [Op.in]: ids } },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (rows.length !== ids.length) {
      const found = new Set(rows.map((r) => Number(r.id)));
      throw Errors.rule('BUSINESS_RULE', 'Some listings were not found; nothing was changed', { missingIds: ids.filter((i) => !found.has(i)) });
    }
    const now = new Date();
    const activity: Array<CreationAttributes<PropertyActivity>> = [];
    const requestId = currentRequestId() ?? null;

    if (input.action === 'reassign') {
      const toName = users.get(input.assigneeId) ?? null;
      for (const r of rows) {
        activity.push({
          tenantId: actor.tenantId,
          propertyId: r.id,
          actorId: actor.userId,
          action: 'BULK_REASSIGN',
          summary: `Assigned: ${r.assigneeId ? (users.get(r.assigneeId) ?? r.assigneeId) : 'nobody'} → ${toName}`,
          diff: {
            assigneeId: { from: r.assigneeId, to: input.assigneeId, fromLabel: r.assigneeId ? (users.get(r.assigneeId) ?? null) : null, toLabel: toName },
          },
          requestId,
        });
      }
      await Property.update(
        { assigneeId: input.assigneeId, version: sequelize.literal('version + 1') as unknown as number, lastActivityAt: now, isStale: false },
        { where: { tenantId: actor.tenantId, id: { [Op.in]: ids } }, transaction },
      );
    } else if (input.action === 'changeStatus') {
      const to = maps.statuses.get(input.statusId)!;
      const terminal = rows.filter((r) => maps.statuses.get(r.statusId)?.isTerminal && r.statusId !== input.statusId);
      if (terminal.length) {
        throw Errors.rule('TERMINAL_STATUS', 'Some listings are Closed/Withdrawn and cannot change status; nothing was changed', {
          ids: terminal.map((r) => r.id),
        });
      }
      for (const r of rows) {
        const from = maps.statuses.get(r.statusId);
        activity.push({
          tenantId: actor.tenantId,
          propertyId: r.id,
          actorId: actor.userId,
          action: 'BULK_STATUS',
          summary: `Status: ${from?.name ?? r.statusId} → ${to.name}`,
          diff: { statusId: { from: r.statusId, to: to.id, fromLabel: from?.name ?? null, toLabel: to.name } },
          requestId,
        });
      }
      await Property.update(
        {
          statusId: to.id,
          closedAt: to.stage === 'WON' ? now : null,
          version: sequelize.literal('version + 1') as unknown as number,
          lastActivityAt: now,
          isStale: false,
        },
        { where: { tenantId: actor.tenantId, id: { [Op.in]: ids } }, transaction },
      );
    } else {
      const amenity = maps.amenities.get(input.amenityId)!;
      await PropertyAmenity.bulkCreate(
        ids.map((propertyId) => ({ propertyId, amenityId: amenity.id })),
        { transaction, ignoreDuplicates: true },
      );
      for (const r of rows) {
        activity.push({
          tenantId: actor.tenantId,
          propertyId: r.id,
          actorId: actor.userId,
          action: 'BULK_AMENITY',
          summary: `Added amenity ${amenity.name}`,
          diff: null,
          requestId,
        });
      }
      await Property.update(
        { version: sequelize.literal('version + 1') as unknown as number, lastActivityAt: now, isStale: false },
        { where: { tenantId: actor.tenantId, id: { [Op.in]: ids } }, transaction },
      );
    }
    await PropertyActivity.bulkCreate(activity, { transaction });
    return { rows };
  });

  await invalidateDashboard(actor.tenantId);
  const assignees = new Set<number | null>(rows.map((r) => r.assigneeId));
  if (input.action === 'reassign') assignees.add(input.assigneeId);
  emitPropertyUpdated(actor.tenantId, { ids, action: `bulk:${input.action}` }, [...assignees]);
  if (input.action === 'reassign') {
    const previous = [...new Set(rows.map((r) => r.assigneeId).filter((a) => a && a !== input.assigneeId))];
    await revokeIfAgent(actor.tenantId, previous, ids);
  }
  return { action: input.action, affected: ids.length, ids };
}

/** Staff can still read a reassigned listing; only former AGENT assignees lose the room. */
async function revokeIfAgent(tenantId: number, userIds: Array<number | null>, propertyIds: number[]) {
  const ids = userIds.filter((u): u is number => !!u);
  if (!ids.length) return;
  const agents = await UserMirror.findAll({ where: { tenantId, id: ids, role: 'AGENT' }, attributes: ['id'] });
  revokePropertyRoom(
    agents.map((a) => a.id),
    propertyIds,
  );
}

// ─────────────────────────────── Activity, notes, chat ───────────────────────────────

export async function listActivity(actor: Actor, propertyId: number) {
  await findScoped(actor, propertyId);
  const [rows, users] = await Promise.all([
    PropertyActivity.findAll({ where: { tenantId: actor.tenantId, propertyId }, order: [['id', 'DESC']], limit: 200 }),
    userNameMap(actor.tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    diff: r.diff,
    actor: r.actorId ? { id: r.actorId, name: users.get(r.actorId) ?? null } : null,
    createdAt: r.createdAt,
  }));
}

async function touchActivity(tenantId: number, propertyId: number) {
  await Property.update({ lastActivityAt: new Date(), isStale: false }, { where: { tenantId, id: propertyId }, silent: true });
}

export async function listNotes(actor: Actor, propertyId: number) {
  await findScoped(actor, propertyId);
  const [rows, users] = await Promise.all([
    PropertyNote.findAll({ where: { tenantId: actor.tenantId, propertyId }, order: [['id', 'DESC']], limit: 200 }),
    userNameMap(actor.tenantId),
  ]);
  return rows.map((n) => ({
    id: n.id,
    propertyId: n.propertyId,
    body: n.body,
    author: { id: n.authorId, name: users.get(n.authorId) ?? null },
    createdAt: n.createdAt,
  }));
}

export async function addNote(actor: Actor, propertyId: number, body: string) {
  await findScoped(actor, propertyId);
  const note = await PropertyNote.create({ tenantId: actor.tenantId, propertyId, authorId: actor.userId, body });
  await touchActivity(actor.tenantId, propertyId);
  const author = await UserMirror.findByPk(actor.userId, { attributes: ['name'] });
  const payload = {
    id: note.id,
    propertyId,
    body: note.body,
    author: { id: actor.userId, name: author?.name ?? actor.name ?? null },
    createdAt: note.createdAt,
  };
  emitToProperty(propertyId, SOCKET_EVENTS.noteNew, payload);
  return payload;
}

export function serializeMessage(m: ChatMessage, senderName: string | null) {
  return {
    id: Number(m.id),
    propertyId: Number(m.propertyId),
    clientMsgId: m.clientMsgId,
    body: m.body,
    sender: { id: m.senderId, name: senderName },
    createdAt: m.createdAt,
  };
}

export async function listMessages(actor: Actor, propertyId: number, q: { beforeId?: number; limit: number }) {
  await findScoped(actor, propertyId);
  const rows = await ChatMessage.findAll({
    where: { tenantId: actor.tenantId, propertyId, ...(q.beforeId ? { id: { [Op.lt]: q.beforeId } } : {}) },
    order: [['id', 'DESC']],
    limit: q.limit,
  });
  const users = await userNameMap(actor.tenantId);
  return {
    data: rows.reverse().map((m) => serializeMessage(m, users.get(m.senderId) ?? null)),
    nextBeforeId: rows.length === q.limit ? Number(rows[0].id) : null,
  };
}

/**
 * Persist-before-broadcast, idempotent on (property_id, client_msg_id). A retry with the same
 * client_msg_id returns the original row with duplicate=true and is NOT broadcast again.
 */
export async function sendMessage(actor: Actor, input: { propertyId: number; clientMsgId: string; body: string }) {
  await findScoped(actor, input.propertyId);
  let duplicate = false;
  let msg: ChatMessage;
  try {
    msg = await ChatMessage.create({
      tenantId: actor.tenantId,
      propertyId: input.propertyId,
      senderId: actor.userId,
      clientMsgId: input.clientMsgId,
      body: input.body,
    });
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
    const existing = await ChatMessage.findOne({ where: { propertyId: input.propertyId, clientMsgId: input.clientMsgId } });
    if (!existing || existing.tenantId !== actor.tenantId) throw err;
    msg = existing;
    duplicate = true;
  }
  const sender = await UserMirror.findByPk(msg.senderId, { attributes: ['name'] });
  const payload = serializeMessage(msg, sender?.name ?? actor.name ?? null);
  if (!duplicate) {
    await touchActivity(actor.tenantId, input.propertyId);
    emitToProperty(input.propertyId, SOCKET_EVENTS.chatNew, payload);
  }
  return { message: payload, duplicate };
}
