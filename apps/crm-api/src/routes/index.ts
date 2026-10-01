import { Router } from 'express';
import { z } from 'zod';
import {
  bulkActionSchema,
  chatHistoryQuerySchema,
  dashboardQuerySchema,
  duplicateCheckQuerySchema,
  idParam,
  inviteSchema,
  masterDataKindParam,
  noteCreateSchema,
  propertyCreateSchema,
  propertyListQuerySchema,
  propertyUpdateSchema,
  reorderSchema,
  siteVisitCreateSchema,
  siteVisitListQuerySchema,
  siteVisitUpdateSchema,
  updateUserSchema,
} from '@propflow/shared';
import { ah } from '../lib/asyncHandler';
import { authenticate, authorize, STAFF, tenantScope, TENANT_ROLES_ALL } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as md from '../controllers/masterData.controller';
import * as misc from '../controllers/misc.controller';
import * as props from '../controllers/property.controller';
import * as visits from '../controllers/siteVisit.controller';
import { proxyToAuth } from '../controllers/usersProxy.controller';

const idParams = validate(z.object({ id: idParam }), 'params');
const kindParams = validate(z.object({ kind: masterDataKindParam, id: idParam.optional() }).passthrough(), 'params');

/**
 * Pipeline for every tenant route (in this order):
 * requestId + logger (app) → authenticate (RS256/JWKS) → tenantScope (req.tenantId = token.tid)
 * → authorize (role) → validate (shared Zod) → controller → service → error handler (app).
 */
export const router = Router();

router.get('/health', ah(misc.health));

// ── Platform (SUPER_ADMIN, no tenant scope; counts only) ──
router.get('/platform/tenant-stats', authenticate, authorize({ roles: ['SUPER_ADMIN'] }), ah(misc.platformStats));

const tenantRouter = Router();
tenantRouter.use(authenticate, tenantScope);

// ── Properties ──
tenantRouter.get('/properties', authorize({ roles: TENANT_ROLES_ALL }), validate(propertyListQuerySchema, 'query'), ah(props.list));
tenantRouter.get('/properties/export', authorize({ roles: STAFF }), validate(propertyListQuerySchema, 'query'), ah(props.exportXlsx));
tenantRouter.get('/properties/check-duplicate', authorize({ roles: TENANT_ROLES_ALL }), validate(duplicateCheckQuerySchema, 'query'), ah(props.checkDuplicate));
tenantRouter.post('/properties', authorize({ roles: TENANT_ROLES_ALL }), validate(propertyCreateSchema), ah(props.create));
tenantRouter.post('/properties/bulk', authorize({ roles: STAFF }), validate(bulkActionSchema), ah(props.bulk));
tenantRouter.get('/properties/:id', authorize({ roles: TENANT_ROLES_ALL }), idParams, ah(props.get));
tenantRouter.patch('/properties/:id', authorize({ roles: TENANT_ROLES_ALL }), idParams, validate(propertyUpdateSchema), ah(props.update));
tenantRouter.delete('/properties/:id', authorize({ roles: STAFF }), idParams, ah(props.remove));
tenantRouter.get('/properties/:id/activity', authorize({ roles: TENANT_ROLES_ALL }), idParams, ah(props.activity));
tenantRouter.get('/properties/:id/notes', authorize({ roles: TENANT_ROLES_ALL }), idParams, ah(props.listNotes));
tenantRouter.post('/properties/:id/notes', authorize({ roles: TENANT_ROLES_ALL }), idParams, validate(noteCreateSchema), ah(props.addNote));
tenantRouter.get(
  '/properties/:id/messages',
  authorize({ roles: TENANT_ROLES_ALL }),
  idParams,
  validate(chatHistoryQuerySchema, 'query'),
  ah(props.listMessages),
);
tenantRouter.post(
  '/properties/:id/messages',
  authorize({ roles: TENANT_ROLES_ALL }),
  idParams,
  validate(
    z.object({
      clientMsgId: z
        .string()
        .trim()
        .min(8)
        .max(64)
        .regex(/^[A-Za-z0-9_-]+$/),
      body: z.string().trim().min(1).max(4000),
    }),
  ),
  ah(props.sendMessage),
);

// ── Site visits ──
tenantRouter.get('/site-visits', authorize({ roles: TENANT_ROLES_ALL }), validate(siteVisitListQuerySchema, 'query'), ah(visits.list));
tenantRouter.post('/site-visits', authorize({ roles: TENANT_ROLES_ALL }), validate(siteVisitCreateSchema), ah(visits.create));
tenantRouter.get('/site-visits/:id', authorize({ roles: TENANT_ROLES_ALL }), idParams, ah(visits.get));
tenantRouter.patch('/site-visits/:id', authorize({ roles: TENANT_ROLES_ALL }), idParams, validate(siteVisitUpdateSchema), ah(visits.update));

// ── Dashboard ──
tenantRouter.get('/dashboard', authorize({ roles: STAFF }), validate(dashboardQuerySchema, 'query'), ah(misc.dashboard));

// ── Master data (read: every tenant role, for forms/filters; write: ADMIN) ──
tenantRouter.get('/master-data', authorize({ roles: TENANT_ROLES_ALL }), ah(md.all));
tenantRouter.get('/master-data/:kind', authorize({ roles: TENANT_ROLES_ALL }), kindParams, ah(md.list));
tenantRouter.post('/master-data/:kind', authorize({ roles: ['ADMIN'] }), kindParams, ah(md.create));
tenantRouter.put('/master-data/:kind/order', authorize({ roles: ['ADMIN'] }), kindParams, validate(reorderSchema), ah(md.reorder));
tenantRouter.patch('/master-data/:kind/:id', authorize({ roles: ['ADMIN'] }), kindParams, ah(md.update));
tenantRouter.delete('/master-data/:kind/:id', authorize({ roles: ['ADMIN'] }), kindParams, ah(md.remove));

// ── Team directory (assignee pickers) ──
tenantRouter.get('/team', authorize({ roles: STAFF }), ah(misc.team));

// ── Users & invites (ADMIN) — forwarded to auth-server, which owns identity ──
const admin = authorize({ roles: ['ADMIN'] });
tenantRouter.get('/users', admin, ah(proxyToAuth));
tenantRouter.get('/users/:id', admin, idParams, ah(proxyToAuth));
tenantRouter.patch('/users/:id', admin, idParams, validate(updateUserSchema), ah(proxyToAuth));
tenantRouter.get('/invites', admin, ah(proxyToAuth));
tenantRouter.post('/invites', admin, validate(inviteSchema), ah(proxyToAuth));
tenantRouter.get('/invites/:id/link', admin, idParams, ah(proxyToAuth));
tenantRouter.delete('/invites/:id', admin, idParams, ah(proxyToAuth));

router.use(tenantRouter);
