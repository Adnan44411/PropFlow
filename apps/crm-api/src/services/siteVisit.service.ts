import type { SiteVisitCreateInput, SiteVisitUpdateInput } from '@propflow/shared';
import { Op, WhereOptions } from 'sequelize';
import { Errors } from '../lib/errors';
import { maskPhone } from '../lib/format';
import { emitToUser } from '../lib/realtime';
import { Actor, isStaff } from '../middleware/auth';
import { Property, SiteVisit } from '../models';
import { assertAssignableUser, userNameMap } from './identity.service';
import { findScoped } from './property.service';
import { canSeeOwnerPhone } from './serializers';

/** Agents see only their own visits; ADMIN/MANAGER see the whole team. */
function visitScope(actor: Actor): WhereOptions {
  return actor.role === 'AGENT' ? { tenantId: actor.tenantId, agentId: actor.userId } : { tenantId: actor.tenantId };
}

function serialize(v: SiteVisit, actor: Actor, users: Map<number, string>) {
  const p = v.property;
  const visitAt = new Date(v.visitAtUtc);
  return {
    id: Number(v.id),
    propertyId: Number(v.propertyId),
    agent: { id: v.agentId, name: users.get(v.agentId) ?? null },
    visitAt: visitAt.toISOString(), // always UTC; the client renders in the user's zone
    endAt: new Date(visitAt.getTime() + v.durationMinutes * 60_000).toISOString(),
    durationMinutes: v.durationMinutes,
    visitorName: v.visitorName,
    visitorPhone: v.visitorPhone,
    notes: v.notes,
    outcome: v.outcome,
    isOverdue: v.outcome === 'SCHEDULED' && visitAt.getTime() < Date.now(),
    remindedAt: v.remindedAt,
    property: p
      ? {
          id: Number(p.id),
          title: p.title,
          buildingName: p.buildingName,
          unitNo: p.unitNo,
          ownerName: p.ownerName,
          // A visit can be scheduled for an agent who is not the listing's assignee: mask then.
          ownerPhone: canSeeOwnerPhone(actor, p) ? p.ownerPhone : maskPhone(p.ownerPhone),
          ownerPhoneMasked: !canSeeOwnerPhone(actor, p),
          assigneeId: p.assigneeId,
        }
      : null,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

const include = [{ model: Property, as: 'property', attributes: ['id', 'title', 'buildingName', 'unitNo', 'ownerName', 'ownerPhone', 'assigneeId'] }];

export async function listVisits(actor: Actor, q: { from?: string; to?: string; agentId?: number; propertyId?: number }) {
  const and: WhereOptions[] = [visitScope(actor)];
  if (q.from) and.push({ visitAtUtc: { [Op.gte]: new Date(q.from) } });
  if (q.to) and.push({ visitAtUtc: { [Op.lte]: new Date(q.to) } });
  if (q.agentId && isStaff(actor)) and.push({ agentId: q.agentId });
  if (q.propertyId) {
    await findScoped(actor, q.propertyId); // 404 if the listing is not visible
    and.push({ propertyId: q.propertyId });
  }
  const [rows, users] = await Promise.all([
    SiteVisit.findAll({ where: { [Op.and]: and }, include, order: [['visitAtUtc', 'ASC']], limit: 2000 }),
    userNameMap(actor.tenantId),
  ]);
  return rows.map((v) => serialize(v, actor, users));
}

async function findVisit(actor: Actor, id: number) {
  const v = await SiteVisit.findOne({ where: { ...visitScope(actor), id } as WhereOptions, include });
  if (!v) throw Errors.notFound('Site visit');
  return v;
}

export async function getVisit(actor: Actor, id: number) {
  return serialize(await findVisit(actor, id), actor, await userNameMap(actor.tenantId));
}

export async function createVisit(actor: Actor, input: SiteVisitCreateInput) {
  const property = await findScoped(actor, input.propertyId);
  let agentId = actor.userId;
  if (input.agentId && input.agentId !== actor.userId) {
    if (!isStaff(actor)) throw Errors.forbiddenRole('Agents can only schedule their own visits');
    await assertAssignableUser(actor.tenantId, input.agentId);
    agentId = input.agentId;
  } else if (!input.agentId && isStaff(actor) && property.assigneeId) {
    agentId = property.assigneeId;
  }
  const v = await SiteVisit.create({
    tenantId: actor.tenantId,
    propertyId: property.id,
    agentId,
    visitAtUtc: new Date(input.visitAt),
    durationMinutes: input.durationMinutes,
    visitorName: input.visitorName ?? null,
    visitorPhone: input.visitorPhone ?? null,
    notes: input.notes ?? null,
    createdBy: actor.userId,
  });
  await Property.update({ lastActivityAt: new Date(), isStale: false }, { where: { id: property.id }, silent: true });
  const out = await getVisit(actor, v.id);
  if (agentId !== actor.userId) emitToUser(agentId, 'visit:created', { id: out.id, propertyId: out.propertyId, visitAt: out.visitAt });
  return out;
}

/** Drag-and-drop reschedule = PATCH { visitAt }. Moving a visit re-arms its reminder. */
export async function updateVisit(actor: Actor, id: number, input: SiteVisitUpdateInput) {
  const v = await findVisit(actor, id);
  if (input.agentId && input.agentId !== v.agentId) {
    if (!isStaff(actor)) throw Errors.forbiddenRole('Agents cannot reassign visits');
    await assertAssignableUser(actor.tenantId, input.agentId);
    v.agentId = input.agentId;
    v.remindedAt = null;
  }
  if (input.visitAt) {
    const next = new Date(input.visitAt);
    if (next.getTime() !== new Date(v.visitAtUtc).getTime()) {
      v.visitAtUtc = next;
      v.remindedAt = null;
    }
  }
  if (input.durationMinutes) v.durationMinutes = input.durationMinutes;
  if (input.outcome) v.outcome = input.outcome;
  if (input.notes !== undefined) v.notes = input.notes;
  await v.save();
  return getVisit(actor, id);
}
