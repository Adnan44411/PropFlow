import { Router } from 'express';
import { z } from 'zod';
import { idParam, inviteSchema, TENANT_ROLES, updateUserSchema } from '@propflow/shared';
import { ah } from '../lib/asyncHandler';
import { authenticate, authorize, requireTenant } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import * as auth from '../services/auth.service';
import * as users from '../services/user.service';

/** Tenant user administration (ADMIN only). crm-api proxies /users and /invites here. */
export const usersRouter = Router();
// Guards are attached per route (a router-level .use() would also run for every route mounted after it).
const adminOnly = [authenticate, authorize({ roles: ['ADMIN'] }), requireTenant];

const listQuery = z.object({
  role: z.enum(TENANT_ROLES).optional(),
  search: z.string().trim().max(100).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
});

usersRouter.get(
  '/users',
  ...adminOnly,
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    res.json({ data: await users.listUsers(req.auth!.tenantId!, req.validatedQuery as z.infer<typeof listQuery>) });
  }),
);

usersRouter.get(
  '/users/:id',
  ...adminOnly,
  validate(z.object({ id: idParam }), 'params'),
  ah(async (req, res) => res.json(await users.getUser(req.auth!.tenantId!, Number(req.params.id)))),
);

usersRouter.patch(
  '/users/:id',
  ...adminOnly,
  validate(z.object({ id: idParam }), 'params'),
  validate(updateUserSchema),
  ah(async (req, res) => {
    res.json(await users.updateUser(req.auth!.tenantId!, Number(req.params.id), req.body, { id: req.auth!.userId, ip: req.ip ?? '' }));
  }),
);

usersRouter.get(
  '/invites',
  ...adminOnly,
  ah(async (req, res) => res.json({ data: await auth.listInvites(req.auth!.tenantId!) })),
);

usersRouter.post(
  '/invites',
  ...adminOnly,
  validate(inviteSchema),
  ah(async (req, res) => {
    res.status(201).json(await auth.createInvite(req.body, { id: req.auth!.userId, tenantId: req.auth!.tenantId! }, { ip: req.ip ?? '' }));
  }),
);

usersRouter.get(
  '/invites/:id/link',
  ...adminOnly,
  validate(z.object({ id: idParam }), 'params'),
  ah(async (req, res) => res.json(await auth.inviteLink(req.auth!.tenantId!, Number(req.params.id)))),
);

usersRouter.delete(
  '/invites/:id',
  ...adminOnly,
  validate(z.object({ id: idParam }), 'params'),
  ah(async (req, res) => res.json(await auth.revokeInvite(req.auth!.tenantId!, Number(req.params.id)))),
);
