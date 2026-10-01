/** Redis pub/sub channel used by auth-server to tell crm-api about identity changes. */
export const EVENTS_CHANNEL = 'propflow:events';

export type PlatformEvent =
  | { type: 'tenant.created'; tenant: { id: number; name: string; slug: string } }
  | {
      type: 'user.upserted';
      user: { id: number; tenantId: number | null; name: string; email: string; role: string; isActive: boolean };
    };

/** Access-token claims (header also carries `kid`). */
export interface AccessTokenClaims {
  sub: string;
  tid: number | null;
  role: import('./roles').Role;
  name?: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

/** Socket.IO event names shared by client and server. */
export const SOCKET_EVENTS = {
  propertyJoin: 'property:join',
  propertyLeave: 'property:leave',
  chatSend: 'chat:send',
  chatNew: 'chat:new',
  typing: 'typing',
  noteNew: 'note:new',
  presence: 'presence',
  propertyUpdated: 'property:updated',
  masterDataUpdated: 'masterdata:updated',
  visitReminder: 'visit:reminder',
  authRenew: 'auth:renew',
} as const;
