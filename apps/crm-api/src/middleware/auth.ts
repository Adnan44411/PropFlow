import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@propflow/shared';
import type { WhereOptions } from 'sequelize';
import { Errors } from '../lib/errors';
import { requestContext } from '../lib/requestContext';
import { touchFromToken } from '../services/identity.service';
import { verifyAccessToken } from '../services/token';

/** 1) authenticate — verify RS256 via JWKS. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(Errors.unauthenticated());
  try {
    req.auth = await verifyAccessToken(header.slice(7).trim());
    const ctx = requestContext.getStore();
    if (ctx) Object.assign(ctx, { userId: req.auth.userId, tenantId: req.auth.tenantId });
    req.log = req.log.child({ userId: req.auth.userId, tenantId: req.auth.tenantId });
    next();
  } catch (err) {
    next(err);
  }
}

/** 2) tenantScope — req.tenantId comes ONLY from the token's `tid`. Platform users have none. */
export async function tenantScope(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(Errors.unauthenticated());
  if (!req.auth.tenantId) return next(Errors.forbiddenRole('Platform accounts cannot access tenant data'));
  req.tenantId = req.auth.tenantId;
  try {
    await touchFromToken(req.auth);
    next();
  } catch (err) {
    next(err);
  }
}

/** 3) authorize({ roles }) — the one reusable role gate. */
export const authorize =
  ({ roles }: { roles: Role[] }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Errors.unauthenticated());
    if (!roles.includes(req.auth.role)) return next(Errors.forbiddenRole());
    next();
  };

export const TENANT_ROLES_ALL: Role[] = ['ADMIN', 'MANAGER', 'AGENT'];
export const STAFF: Role[] = ['ADMIN', 'MANAGER'];

export interface Actor {
  userId: number;
  tenantId: number;
  role: Role;
  name?: string;
}

export const actorOf = (req: Request): Actor => ({ userId: req.auth!.userId, tenantId: req.tenantId, role: req.auth!.role, name: req.auth!.name });

/**
 * Scoping helper: every property query goes through this. Adds tenant_id always and,
 * for AGENTs, assignee_id = self. Rows outside the scope are simply "not found" (404, never 403).
 */
export function propertyScope(actor: Actor): WhereOptions & { tenantId: number; assigneeId?: number } {
  return actor.role === 'AGENT' ? { tenantId: actor.tenantId, assigneeId: actor.userId } : { tenantId: actor.tenantId };
}

export const isStaff = (actor: Actor) => actor.role === 'ADMIN' || actor.role === 'MANAGER';
