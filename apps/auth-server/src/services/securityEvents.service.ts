import { logger } from '../lib/logger';
import { currentRequestId } from '../lib/requestContext';
import { SecurityEvent, SecurityEventType } from '../models';

const SEVERITY: Record<SecurityEventType, 'INFO' | 'WARN' | 'CRITICAL'> = {
  LOGIN_SUCCESS: 'INFO',
  LOGIN_FAILED: 'WARN',
  LOGIN_LOCKED: 'WARN',
  REFRESH_REUSE_DETECTED: 'CRITICAL',
  LOGOUT: 'INFO',
  LOGOUT_ALL: 'INFO',
  KEY_ROTATED: 'WARN',
  TENANT_CREATED: 'INFO',
  INVITE_CREATED: 'INFO',
  INVITE_ACCEPTED: 'INFO',
  USER_UPDATED: 'INFO',
};

export interface SecurityEventInput {
  type: SecurityEventType;
  userId?: number | null;
  tenantId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

/** Persist + log. Never throws (auditing must not break auth flows). */
export async function recordSecurityEvent(e: SecurityEventInput): Promise<void> {
  const severity = SEVERITY[e.type];
  const log = severity === 'INFO' ? logger.info.bind(logger) : logger.warn.bind(logger);
  log('security event', { event: e.type, severity, userId: e.userId, tenantId: e.tenantId, ip: e.ip, meta: e.meta });
  try {
    await SecurityEvent.create({
      type: e.type,
      severity,
      userId: e.userId ?? null,
      tenantId: e.tenantId ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent?.slice(0, 255) ?? null,
      requestId: currentRequestId() ?? null,
      meta: e.meta ?? null,
    });
  } catch (err) {
    logger.error('failed to persist security event', { err });
  }
}
