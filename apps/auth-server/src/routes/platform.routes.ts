import { Router } from 'express';
import { z } from 'zod';
import { createTenantSchema, idParam } from '@propflow/shared';
import { Op } from 'sequelize';
import { ah } from '../lib/asyncHandler';
import { keyStore } from '../keys/keyStore';
import { authenticate, authorize } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { SecurityEvent } from '../models';
import * as auth from '../services/auth.service';
import { recordSecurityEvent } from '../services/securityEvents.service';

/** SUPER_ADMIN only. Returns counts and metadata — never property details, owner phones or chats. */
export const platformRouter = Router();
const superAdmin = [authenticate, authorize({ roles: ['SUPER_ADMIN'] })];

platformRouter.get(
  '/platform/tenants',
  ...superAdmin,
  ah(async (_req, res) => res.json({ data: await auth.listTenantsWithCounts() })),
);

platformRouter.post(
  '/platform/tenants',
  ...superAdmin,
  validate(createTenantSchema),
  ah(async (req, res) => res.status(201).json(await auth.createTenantWithAdminInvite(req.body, req.auth!.userId, { ip: req.ip ?? '' }))),
);

platformRouter.patch(
  '/platform/tenants/:id',
  ...superAdmin,
  validate(z.object({ id: idParam }), 'params'),
  validate(z.object({ isActive: z.boolean() })),
  ah(async (req, res) => res.json(await auth.setTenantActive(Number(req.params.id), req.body.isActive))),
);

const eventsQuery = z.object({
  type: z.string().max(40).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

platformRouter.get(
  '/platform/security-events',
  ...superAdmin,
  validate(eventsQuery, 'query'),
  ah(async (req, res) => {
    const q = req.validatedQuery as z.infer<typeof eventsQuery>;
    const where: Record<string, unknown> = {};
    if (q.type) where.type = q.type;
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.beforeId) where.id = { [Op.lt]: q.beforeId };
    const rows = await SecurityEvent.findAll({ where, order: [['id', 'DESC']], limit: q.limit });
    res.json({ data: rows, nextBeforeId: rows.length === q.limit ? rows[rows.length - 1].id : null });
  }),
);

platformRouter.get(
  '/admin/keys',
  ...superAdmin,
  ah(async (_req, res) => res.json({ data: keyStore.list() })),
);

platformRouter.post(
  '/admin/rotate-keys',
  ...superAdmin,
  ah(async (req, res) => {
    const result = await keyStore.rotate();
    await recordSecurityEvent({ type: 'KEY_ROTATED', userId: req.auth!.userId, ip: req.ip, meta: result });
    res.status(201).json({ ...result, keys: keyStore.list() });
  }),
);
