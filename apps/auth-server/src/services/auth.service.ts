import bcrypt from 'bcryptjs';
import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import type { AcceptInviteInput, CreateTenantInput, InviteInput, LoginInput, RegisterTenantInput, Role } from '@propflow/shared';
import { config } from '../config';
import { sequelize } from '../lib/db';
import { AppError, Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { Invite, Tenant, User } from '../models';
import { publishTenantCreated, publishUserUpserted } from './events.service';
import { assertNotLocked, clearFailures, recordFailure } from './rateLimit.service';
import { refreshStore } from './refresh.service';
import { recordSecurityEvent } from './securityEvents.service';
import { issueAccessToken, signInviteToken, verifyInviteToken } from './token.service';

export interface ClientInfo {
  ip: string;
  userAgent?: string;
}

export interface SessionResult {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  refreshToken: string;
  user: ReturnType<User['toPublic']>;
  tenant: { id: number; name: string; slug: string } | null;
}

// Pre-computed hash so unknown emails cost the same bcrypt time as known ones (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export const hashPassword = (plain: string) => bcrypt.hash(plain, config.BCRYPT_ROUNDS);

async function startSession(user: User, client: ClientInfo, familyId?: string): Promise<SessionResult> {
  const tenant = user.tenantId ? await Tenant.findByPk(user.tenantId) : null;
  const { accessToken, expiresIn } = issueAccessToken({ id: user.id, tenantId: user.tenantId ?? null, role: user.role, name: user.name });
  const { token } = await refreshStore.issue({ userId: user.id, tenantId: user.tenantId ?? null, familyId, ua: client.userAgent, ip: client.ip });
  return {
    accessToken,
    expiresIn,
    tokenType: 'Bearer',
    refreshToken: token,
    user: user.toPublic(),
    tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug } : null,
  };
}

function mapUniqueError(err: unknown): never {
  if (err instanceof UniqueConstraintError) {
    const fields = Object.keys(err.fields ?? {}).join(',');
    if (fields.includes('slug')) throw Errors.conflict('SLUG_TAKEN', 'This slug is already taken', { fields: { slug: 'This slug is already taken' } });
    if (fields.includes('email'))
      throw Errors.conflict('EMAIL_TAKEN', 'An account with this email already exists', { fields: { email: 'An account with this email already exists' } });
    throw Errors.conflict('CONFLICT', 'Duplicate value');
  }
  throw err;
}

/** POST /auth/register-tenant — tenant + ADMIN in one DB transaction, then logs the admin in. */
export async function registerTenant(input: RegisterTenantInput, client: ClientInfo): Promise<SessionResult> {
  const passwordHash = await hashPassword(input.password);
  let tenant: Tenant;
  let admin: User;
  try {
    ({ tenant, admin } = await sequelize.transaction(async (transaction) => {
      const t = await Tenant.create({ name: input.companyName, slug: input.slug }, { transaction });
      const u = await User.create({ tenantId: t.id, email: input.adminEmail, name: input.adminName, passwordHash, role: 'ADMIN' }, { transaction });
      return { tenant: t, admin: u };
    }));
  } catch (err) {
    mapUniqueError(err);
  }
  await recordSecurityEvent({ type: 'TENANT_CREATED', userId: admin.id, tenantId: tenant.id, ip: client.ip, meta: { slug: tenant.slug, via: 'self-signup' } });
  await publishTenantCreated(tenant);
  await publishUserUpserted(admin);
  return startSession(admin, client);
}

/** POST /auth/login — rate limited per ip+email (5 failures → 15 min lockout). */
export async function login(input: LoginInput, client: ClientInfo): Promise<SessionResult> {
  await assertNotLocked(client.ip, input.email);
  const user = await User.findOne({ where: { email: input.email } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    const { remaining, retryAfter } = await recordFailure(client.ip, input.email);
    await recordSecurityEvent({
      type: remaining === 0 ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
      userId: user?.id ?? null,
      tenantId: user?.tenantId ?? null,
      ip: client.ip,
      userAgent: client.userAgent,
      meta: { email: input.email, remaining },
    });
    if (remaining === 0) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many failed attempts. Account locked for 15 minutes.',
        { retryAfter },
        { 'Retry-After': String(retryAfter) },
      );
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect', {
      remainingAttempts: remaining,
      fields: { password: `Email or password is incorrect (${remaining} attempt${remaining === 1 ? '' : 's'} left)` },
    });
  }
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  if (user.tenantId) {
    const tenant = await Tenant.findByPk(user.tenantId);
    if (!tenant?.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This agency has been suspended');
  }
  await clearFailures(client.ip, input.email);
  user.lastLoginAt = new Date();
  await user.save();
  await recordSecurityEvent({ type: 'LOGIN_SUCCESS', userId: user.id, tenantId: user.tenantId ?? null, ip: client.ip, userAgent: client.userAgent });
  return startSession(user, client);
}

/**
 * POST /auth/refresh — rotation with reuse detection.
 * A token that was already used means it leaked: the whole family (including the legitimate
 * newest token) is deleted and a CRITICAL security event is logged.
 */
export async function refresh(rawToken: string | undefined, client: ClientInfo): Promise<SessionResult> {
  if (!rawToken) throw new AppError(401, 'REFRESH_INVALID', 'No refresh token');
  const result = await refreshStore.consume(rawToken);
  if (result.status === 'invalid') throw new AppError(401, 'REFRESH_INVALID', 'Refresh token is invalid or expired');
  if (result.status === 'reused') {
    const revoked = await refreshStore.revokeFamily(result.record.familyId, result.record.userId);
    await recordSecurityEvent({
      type: 'REFRESH_REUSE_DETECTED',
      userId: result.record.userId,
      tenantId: result.record.tenantId,
      ip: client.ip,
      userAgent: client.userAgent,
      meta: { familyId: result.record.familyId, revokedTokens: revoked, originalIp: result.record.ip },
    });
    throw new AppError(401, 'REFRESH_REUSED', 'Refresh token reuse detected. All sessions in this family were revoked.');
  }
const user = await User.findOne({ where: { id: result.record.userId } });
  const tenantOk = !user?.tenantId || (await Tenant.findByPk(user.tenantId))?.isActive;
  if (!user || !user.isActive || !tenantOk) {
    await refreshStore.revokeFamily(result.record.familyId, result.record.userId);
    throw new AppError(401, 'REFRESH_INVALID', 'Account is no longer active');
  }
  return startSession(user, client, result.record.familyId);
}

/** POST /auth/logout — revoke this session's family. Idempotent. */
export async function logout(rawToken: string | undefined, client: ClientInfo): Promise<void> {
  if (!rawToken) return;
  const record = await refreshStore.peek(rawToken);
  if (!record) return;
  await refreshStore.revokeFamily(record.familyId, record.userId);
  await recordSecurityEvent({ type: 'LOGOUT', userId: record.userId, tenantId: record.tenantId, ip: client.ip, meta: { familyId: record.familyId } });
}

/** POST /auth/logout-all — every session of the user. */
export async function logoutAll(userId: number, tenantId: number | null, client: ClientInfo): Promise<number> {
  const count = await refreshStore.revokeAllForUser(userId);
  await recordSecurityEvent({ type: 'LOGOUT_ALL', userId, tenantId, ip: client.ip, meta: { families: count } });
  return count;
}

// ─────────────────────────────── Invites ────────────────────────────────

function inviteUrl(token: string): string {
  return `${config.WEB_URL.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
}

async function createInviteTx(
  input: { tenantId: number; email: string; name: string; role: Role; invitedBy: number | null },
  transaction: Transaction,
): Promise<Invite> {
  const existingUser = await User.findOne({ where: { email: input.email }, transaction });
  if (existingUser)
    throw Errors.conflict('EMAIL_TAKEN', 'A user with this email already exists', { fields: { email: 'A user with this email already exists' } });
  // Only one pending invite per email per tenant: revoke older ones.
  await Invite.update({ revokedAt: new Date() }, { where: { tenantId: input.tenantId, email: input.email, acceptedAt: null, revokedAt: null }, transaction });
  return Invite.create(
    {
      tenantId: input.tenantId,
      email: input.email,
      name: input.name,
      role: input.role,
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + config.INVITE_TTL_SECONDS * 1000),
    },
    { transaction },
  );
}

function withLink(invite: Invite) {
  const token = signInviteToken({ inviteId: invite.id, tenantId: invite.tenantId, email: invite.email, role: invite.role });
  const url = inviteUrl(token);
  // No real email: the link is logged (and returned) so the reviewer can use it.
  logger.info('invite link created', { inviteId: invite.id, tenantId: invite.tenantId, email: invite.email, role: invite.role, inviteUrl: url });
  return { invite: invite.toPublic(), inviteUrl: url, inviteToken: token };
}

/** POST /auth/invite (ADMIN) */
export async function createInvite(input: InviteInput, actor: { id: number; tenantId: number }, client: ClientInfo) {
  const invite = await sequelize.transaction((transaction) =>
    createInviteTx({ tenantId: actor.tenantId, email: input.email, name: input.name, role: input.role, invitedBy: actor.id }, transaction),
  );
  await recordSecurityEvent({
    type: 'INVITE_CREATED',
    userId: actor.id,
    tenantId: actor.tenantId,
    ip: client.ip,
    meta: { inviteId: invite.id, role: invite.role },
  });
  return withLink(invite);
}

export async function listInvites(tenantId: number) {
  const invites = await Invite.findAll({ where: { tenantId }, order: [['createdAt', 'DESC']], limit: 200 });
  return invites.map((i) => i.toPublic());
}

export async function revokeInvite(tenantId: number, inviteId: number) {
  const invite = await Invite.findOne({ where: { id: inviteId, tenantId } });
  if (!invite) throw Errors.notFound('Invite');
  if (invite.acceptedAt) throw Errors.rule('BUSINESS_RULE', 'Invite was already accepted');
  invite.revokedAt = invite.revokedAt ?? new Date();
  await invite.save();
  return invite.toPublic();
}

/** Re-issue a signed link for a pending invite ("Copy link" in the Users screen). */
export async function inviteLink(tenantId: number, inviteId: number) {
  const invite = await Invite.findOne({ where: { id: inviteId, tenantId } });
  if (!invite) throw Errors.notFound('Invite');
  if (invite.state !== 'PENDING') throw Errors.rule('INVITE_INVALID', `Invite is ${invite.state.toLowerCase()}`);
  return withLink(invite);
}

async function loadValidInvite(token: string, transaction?: Transaction) {
  const claims = verifyInviteToken(token);
  const invite = await Invite.findByPk(claims.inviteId, { transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!invite || invite.email !== claims.email || invite.tenantId !== claims.tenantId) {
    throw Errors.rule('INVITE_INVALID', 'Invite link is invalid');
  }
  if (invite.state !== 'PENDING')
    throw Errors.rule('INVITE_INVALID', `Invite link has already been ${invite.state === 'EXPIRED' ? 'expired' : invite.state.toLowerCase()}`);
  return invite;
}

/** GET /auth/invite-info?token= — lets the Accept-invite page show who/what before submitting. */
export async function inviteInfo(token: string) {
  const invite = await loadValidInvite(token);
  const tenant = await Tenant.findByPk(invite.tenantId);
  return {
    email: invite.email,
    name: invite.name,
    role: invite.role,
    tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug } : null,
    expiresAt: invite.expiresAt,
  };
}

/** POST /auth/accept-invite — single use (row lock + accepted_at), creates the user and logs them in. */
export async function acceptInvite(input: AcceptInviteInput, client: ClientInfo): Promise<SessionResult> {
  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await sequelize.transaction(async (transaction) => {
      const invite = await loadValidInvite(input.token, transaction);
      const u = await User.create(
        { tenantId: invite.tenantId, email: invite.email, name: input.name ?? invite.name, passwordHash, role: invite.role },
        { transaction },
      );
      invite.acceptedAt = new Date();
      invite.acceptedUserId = u.id;
      await invite.save({ transaction });
      return u;
    });
  } catch (err) {
    mapUniqueError(err);
  }
  await recordSecurityEvent({ type: 'INVITE_ACCEPTED', userId: user.id, tenantId: user.tenantId ?? null, ip: client.ip });
  await publishUserUpserted(user);
  return startSession(user, client);
}

// ─────────────────────────── Platform (SUPER_ADMIN) ───────────────────────────

/** POST /platform/tenants — tenant + first ADMIN invite in one transaction, returns the link. */
export async function createTenantWithAdminInvite(input: CreateTenantInput, actorId: number, client: ClientInfo) {
  let tenant: Tenant;
  let invite: Invite;
  try {
    ({ tenant, invite } = await sequelize.transaction(async (transaction) => {
      const t = await Tenant.create({ name: input.companyName, slug: input.slug }, { transaction });
      const i = await createInviteTx({ tenantId: t.id, email: input.adminEmail, name: input.adminName, role: 'ADMIN', invitedBy: actorId }, transaction);
      return { tenant: t, invite: i };
    }));
  } catch (err) {
    mapUniqueError(err);
  }
  await recordSecurityEvent({ type: 'TENANT_CREATED', userId: actorId, tenantId: tenant.id, ip: client.ip, meta: { slug: tenant.slug, via: 'platform' } });
  await publishTenantCreated(tenant);
  const link = withLink(invite);
  return { tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, isActive: tenant.isActive, createdAt: tenant.createdAt }, ...link };
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  return (await Tenant.count({ where: { slug } })) === 0;
}

export async function listTenantsWithCounts() {
  const tenants = await Tenant.findAll({ order: [['createdAt', 'ASC']] });
  const counts = (await User.findAll({
    attributes: ['tenantId', 'role', 'isActive', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where: { tenantId: { [Op.ne]: null } },
    group: ['tenantId', 'role', 'isActive'],
    raw: true,
  })) as unknown as Array<{ tenantId: number; role: Role; isActive: number | boolean; count: number }>;
  const pending = (await Invite.findAll({
    attributes: ['tenantId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where: { acceptedAt: null, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    group: ['tenantId'],
    raw: true,
  })) as unknown as Array<{ tenantId: number; count: number }>;

  return tenants.map((t) => {
    const rows = counts.filter((c) => c.tenantId === t.id);
    const byRole: Record<string, number> = { ADMIN: 0, MANAGER: 0, AGENT: 0 };
    let active = 0;
    let total = 0;
    for (const r of rows) {
      total += Number(r.count);
      if (r.isActive) {
        active += Number(r.count);
        byRole[r.role] = (byRole[r.role] ?? 0) + Number(r.count);
      }
    }
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      isActive: t.isActive,
      createdAt: t.createdAt,
      userCount: total,
      activeUserCount: active,
      usersByRole: byRole,
      pendingInvites: Number(pending.find((p) => p.tenantId === t.id)?.count ?? 0),
    };
  });
}

export async function setTenantActive(tenantId: number, isActive: boolean) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw Errors.notFound('Tenant');
  tenant.isActive = isActive;
  await tenant.save();
  if (!isActive) {
    const users = await User.findAll({ where: { tenantId }, attributes: ['id'] });
    for (const u of users) await refreshStore.revokeAllForUser(u.id);
  }
  return { id: tenant.id, name: tenant.name, slug: tenant.slug, isActive: tenant.isActive, createdAt: tenant.createdAt };
}
