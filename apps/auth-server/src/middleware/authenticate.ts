import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@propflow/shared';
import { Errors } from '../lib/errors';
import { requestContext } from '../lib/requestContext';
import { verifyAccessToken } from '../services/token.service';

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(Errors.unauthenticated());
  try {
    const claims = verifyAccessToken(header.slice(7).trim());
    req.auth = { userId: Number(claims.sub), tenantId: claims.tid ?? null, role: claims.role, name: claims.name, jti: claims.jti };
    const ctx = requestContext.getStore();
    if (ctx) Object.assign(ctx, { userId: req.auth.userId, tenantId: req.auth.tenantId });
    next();
  } catch (err) {
    next(err);
  }
}

/** authorize({ roles: [...] }) — one reusable role gate; 403 FORBIDDEN_ROLE otherwise. */
export const authorize =
  ({ roles }: { roles: Role[] }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Errors.unauthenticated());
    if (!roles.includes(req.auth.role)) return next(Errors.forbiddenRole());
    next();
  };

/** For tenant-scoped admin endpoints: req.auth.tenantId must be present (SUPER_ADMIN has none). */
export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.tenantId) return next(Errors.forbiddenRole('This endpoint is only available inside a tenant'));
  next();
}
