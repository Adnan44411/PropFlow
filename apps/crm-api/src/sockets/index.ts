import { createAdapter } from '@socket.io/redis-adapter';
import type http from 'node:http';
import crypto from 'node:crypto';
import { Server, Socket } from 'socket.io';
import { chatSendSchema, SOCKET_EVENTS } from '@propflow/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { rooms, setIo } from '../lib/realtime';
import { createRedis } from '../lib/redis';
import { requestContext } from '../lib/requestContext';
import type { Actor } from '../middleware/auth';
import { touchFromToken } from '../services/identity.service';
import { onMasterDataChanged } from '../services/masterData.service';
import { canReadProperty, sendMessage } from '../services/property.service';
import { AuthContext, verifyAccessToken } from '../services/token';

interface SocketData {
  auth: AuthContext;
  connId: string;
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }) => void;

const actorOf = (s: Socket): Actor => {
  const a = (s.data as SocketData).auth;
  return { userId: a.userId, tenantId: a.tenantId!, role: a.role, name: a.name };
};

function toAckError(err: unknown) {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details };
  logger.error('socket handler error', { err });
  return { code: 'INTERNAL', message: 'Something went wrong' };
}

/** Wrap each handler: new requestId for logs, token-expiry check, ack with one error shape. */
function handler(socket: Socket, name: string, fn: (payload: unknown, ack: Ack) => Promise<void>) {
  socket.on(name, (payload: unknown, maybeAck?: Ack) => {
    const ack: Ack = typeof maybeAck === 'function' ? maybeAck : () => undefined;
    const data = socket.data as SocketData;
    const requestId = `ws-${data.connId}-${crypto.randomBytes(3).toString('hex')}`;
    requestContext.run({ requestId, userId: data.auth.userId, tenantId: data.auth.tenantId }, () => {
      if (name !== SOCKET_EVENTS.authRenew && data.auth.exp * 1000 < Date.now()) {
        // The client refreshes, emits auth:renew and retries with the SAME client_msg_id — nothing is lost.
        return ack({ ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token expired; renew and retry' } });
      }
      fn(payload, ack).catch((err) => ack({ ok: false, error: toAckError(err) }));
    });
  });
}

async function presence(io: Server, propertyId: number) {
  const sockets = await io.in(rooms.property(propertyId)).fetchSockets();
  const users = new Map<number, { id: number; name?: string }>();
  for (const s of sockets) {
    const a = (s.data as SocketData).auth;
    users.set(a.userId, { id: a.userId, name: a.name });
  }
  io.to(rooms.property(propertyId)).emit(SOCKET_EVENTS.presence, { propertyId, users: [...users.values()] });
}

export async function createSocketServer(httpServer: http.Server): Promise<{ io: Server; close: () => Promise<void> }> {
  const io = new Server(httpServer, {
    cors: { origin: config.webOrigins, credentials: true },
    pingInterval: config.SOCKET_PING_INTERVAL_MS,
    // Works behind nginx with ip_hash; clients that pick websocket-only need no stickiness at all.
    transports: ['websocket', 'polling'],
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
  });

  // Redis adapter: an emit on instance #1 reaches sockets connected to instance #2 (H9).
  const pub = createRedis('socket-pub');
  const sub = createRedis('socket-sub');
  io.adapter(createAdapter(pub, sub, { key: 'socket.io' }));

  // Handshake: access token in `auth.token`. Invalid/expired → connection refused.
  io.use(async (socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? socket.handshake.headers.authorization?.replace(/^Bearer /, '');
    if (!token) return next(Object.assign(new Error('UNAUTHENTICATED'), { data: { code: 'UNAUTHENTICATED' } }));
    try {
      const auth = await verifyAccessToken(token);
      if (!auth.tenantId) return next(Object.assign(new Error('FORBIDDEN_ROLE'), { data: { code: 'FORBIDDEN_ROLE' } }));
      await touchFromToken(auth);
      socket.data = { auth, connId: crypto.randomBytes(4).toString('hex') } satisfies SocketData;
      next();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'INVALID_TOKEN';
      next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    const actor = actorOf(socket);
    socket.join([rooms.user(actor.userId), rooms.tenant(actor.tenantId)]);
    if (actor.role === 'ADMIN' || actor.role === 'MANAGER') socket.join(rooms.staff(actor.tenantId));
    logger.info('socket connected', { connId: data.connId, userId: actor.userId, tenantId: actor.tenantId, instance: config.INSTANCE_ID });

    handler(socket, SOCKET_EVENTS.authRenew, async (payload, ack) => {
      const token = (payload as { token?: string })?.token;
      if (!token) throw new AppError(400, 'VALIDATION_ERROR', 'token is required');
      const next = await verifyAccessToken(token);
      if (next.userId !== data.auth.userId || next.tenantId !== data.auth.tenantId) throw new AppError(401, 'INVALID_TOKEN', 'Token belongs to another user');
      data.auth = next;
      ack({ ok: true, exp: next.exp });
    });

    // Join a property room only if the user may read that property (tenant + agent ownership).
    handler(socket, SOCKET_EVENTS.propertyJoin, async (payload, ack) => {
      const propertyId = Number((payload as { propertyId?: unknown })?.propertyId);
      if (!Number.isInteger(propertyId) || propertyId <= 0) throw new AppError(400, 'VALIDATION_ERROR', 'propertyId is required');
      if (!(await canReadProperty(actorOf(socket), propertyId))) throw new AppError(404, 'NOT_FOUND', 'Property not found');
      await socket.join(rooms.property(propertyId));
      ack({ ok: true, room: rooms.property(propertyId) });
      await presence(io, propertyId);
    });

    handler(socket, SOCKET_EVENTS.propertyLeave, async (payload, ack) => {
      const propertyId = Number((payload as { propertyId?: unknown })?.propertyId);
      await socket.leave(rooms.property(propertyId));
      ack({ ok: true });
      await presence(io, propertyId);
    });

    handler(socket, SOCKET_EVENTS.typing, async (payload) => {
      const p = payload as { propertyId?: number; isTyping?: boolean };
      const propertyId = Number(p?.propertyId);
      if (!socket.rooms.has(rooms.property(propertyId))) return;
      socket.to(rooms.property(propertyId)).emit(SOCKET_EVENTS.typing, {
        propertyId,
        user: { id: data.auth.userId, name: data.auth.name },
        isTyping: Boolean(p.isTyping),
      });
    });

    // chat:send → validate → persist (unique property_id+client_msg_id) → ack → broadcast chat:new.
    handler(socket, SOCKET_EVENTS.chatSend, async (payload, ack) => {
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid message', parsed.error.flatten().fieldErrors);
      const room = rooms.property(parsed.data.propertyId);
      if (!socket.rooms.has(room)) {
        if (!(await canReadProperty(actorOf(socket), parsed.data.propertyId))) throw new AppError(404, 'NOT_FOUND', 'Property not found');
        await socket.join(room);
      }
      const { message, duplicate } = await sendMessage(actorOf(socket), parsed.data);
      ack({ ok: true, id: message.id, createdAt: message.createdAt, duplicate, message });
    });

    socket.on('disconnecting', () => {
      const propertyRooms = [...socket.rooms].filter((r) => r.startsWith('property:'));
      setTimeout(() => {
        for (const r of propertyRooms) presence(io, Number(r.split(':')[1])).catch(() => undefined);
      }, 50);
    });
    socket.on('disconnect', (reason) => logger.info('socket disconnected', { connId: data.connId, reason }));
  });

  onMasterDataChanged((tenantId, kind) => io.to(rooms.tenant(tenantId)).emit(SOCKET_EVENTS.masterDataUpdated, { tenantId, kind }));
  setIo(io);

  return {
    io,
    close: async () => {
      setIo(null);
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
