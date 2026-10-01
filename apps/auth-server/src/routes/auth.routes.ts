import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import { acceptInviteSchema, inviteSchema, loginSchema, registerTenantSchema } from '@propflow/shared';
import { config } from '../config';
import { ah } from '../lib/asyncHandler';
import { User } from '../models';
import { authenticate, authorize, requireTenant } from '../middleware/authenticate';
import { cookieOriginCheck } from '../middleware/originCheck';
import { validate } from '../middleware/validate';
import * as auth from '../services/auth.service';
import { Errors } from '../lib/errors';

export const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: config.COOKIE_SAMESITE,
  domain: config.COOKIE_DOMAIN || undefined,
  path: config.COOKIE_PATH,
  maxAge: config.REFRESH_TOKEN_TTL_SECONDS * 1000,
});

const client = (req: Request): auth.ClientInfo => ({ ip: req.ip ?? 'unknown', userAgent: req.header('user-agent') ?? undefined });

/** Refresh token only ever travels in the httpOnly cookie, never in a JSON body. */
function sendSession(res: Response, status: number, s: auth.SessionResult) {
  res.cookie(config.COOKIE_NAME, s.refreshToken, cookieOptions());
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ accessToken: s.accessToken, tokenType: s.tokenType, expiresIn: s.expiresIn, user: s.user, tenant: s.tenant });
}

function clearCookie(res: Response) {
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(config.COOKIE_NAME, opts);
}

export const authRouter = Router();

authRouter.post(
  '/register-tenant',
  validate(registerTenantSchema),
  ah(async (req, res) => sendSession(res, 201, await auth.registerTenant(req.body, client(req)))),
);

authRouter.post(
  '/login',
  validate(loginSchema),
  ah(async (req, res) => sendSession(res, 200, await auth.login(req.body, client(req)))),
);

authRouter.post(
  '/refresh',
  cookieOriginCheck,
  ah(async (req, res) => {
    try {
      console.log('[refresh-debug]', {
        cookieHeaderPresent: Boolean(req.headers.cookie),
        cookieNames: Object.keys(req.cookies ?? {}),
        origin: req.header('origin'),
      });
      sendSession(res, 200, await auth.refresh(req.cookies?.[config.COOKIE_NAME], client(req)));
    } catch (err) {
      clearCookie(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  cookieOriginCheck,
  ah(async (req, res) => {
    await auth.logout(req.cookies?.[config.COOKIE_NAME], client(req));
    clearCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout-all',
  authenticate,
  ah(async (req, res) => {
    const sessions = await auth.logoutAll(req.auth!.userId, req.auth!.tenantId, client(req));
    clearCookie(res);
    res.json({ revokedSessions: sessions });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const user = await User.findByPk(req.auth!.userId);
    if (!user || !user.isActive) throw Errors.unauthenticated('Account no longer active');
    res.json({ user: user.toPublic() });
  }),
);

authRouter.post(
  '/invite',
  authenticate,
  authorize({ roles: ['ADMIN'] }),
  requireTenant,
  validate(inviteSchema),
  ah(async (req, res) => {
    res.status(201).json(await auth.createInvite(req.body, { id: req.auth!.userId, tenantId: req.auth!.tenantId! }, client(req)));
  }),
);

authRouter.get(
  '/invite-info',
  validate(z.object({ token: z.string().min(20) }), 'query'),
  ah(async (req, res) => {
    res.json(await auth.inviteInfo((req.validatedQuery as { token: string }).token));
  }),
);

authRouter.post(
  '/accept-invite',
  validate(acceptInviteSchema),
  ah(async (req, res) => sendSession(res, 201, await auth.acceptInvite(req.body, client(req)))),
);

authRouter.get(
  '/slug-available',
  validate(z.object({ slug: z.string().min(1).max(60) }), 'query'),
  ah(async (req, res) => {
    const { slug } = req.validatedQuery as { slug: string };
    res.json({ slug, available: await auth.isSlugAvailable(slug.toLowerCase()) });
  }),
);
