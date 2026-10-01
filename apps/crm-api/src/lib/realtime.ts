import type { Server } from 'socket.io';
import { SOCKET_EVENTS } from '@propflow/shared';

/**
 * Thin bridge so services can emit without importing the socket server (and so tests
 * without sockets still work). With the Redis adapter, emits fan out to every instance.
 */
let io: Server | null = null;
export const setIo = (server: Server | null) => {
  io = server;
};

export const rooms = {
  property: (id: number) => `property:${id}`,
  user: (id: number) => `user:${id}`,
  /** ADMIN + MANAGER of a tenant (they can see every listing). */
  staff: (tenantId: number) => `tenant:${tenantId}:staff`,
  tenant: (tenantId: number) => `tenant:${tenantId}`,
};

export function emitToProperty(propertyId: number, event: string, payload: unknown) {
  io?.to(rooms.property(propertyId)).emit(event, payload);
}

export function emitToUser(userId: number, event: string, payload: unknown) {
  io?.to(rooms.user(userId)).emit(event, payload);
}

/**
 * property:updated → staff of the tenant + the assignee(s) of the changed rows, so open
 * tables refresh the changed row. Agents never receive ids of listings they cannot see.
 */
export function emitPropertyUpdated(
  tenantId: number,
  payload: { ids: number[]; action: string; version?: number },
  assigneeIds: Array<number | null | undefined>,
) {
  if (!io) return;
  const targets = new Set<string>([rooms.staff(tenantId)]);
  for (const a of assigneeIds) if (a) targets.add(rooms.user(a));
  io.to([...targets]).emit(SOCKET_EVENTS.propertyUpdated, { tenantId, ...payload });
}

export function emitToTenant(tenantId: number, event: string, payload: unknown) {
  io?.to(rooms.tenant(tenantId)).emit(event, payload);
}

/**
 * When a listing is reassigned away from an agent, pull that agent's sockets (on every instance,
 * via the Redis adapter) out of the property room so they stop receiving its chat/notes.
 */
export function revokePropertyRoom(userIds: Array<number | null | undefined>, propertyIds: number[]) {
  if (!io) return;
  for (const u of userIds) {
    if (!u) continue;
    for (const p of propertyIds) io.in(rooms.user(u)).socketsLeave(rooms.property(p));
  }
}
