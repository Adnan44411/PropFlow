import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { sequelize } from '../src/lib/db';
import { createMigrator } from '../src/lib/migrator';
import { redis } from '../src/lib/redis';
import { keyStore } from '../src/keys/keyStore';
import { Tenant, User } from '../src/models';
import { hashPassword } from '../src/services/auth.service';

export const PASSWORD = 'Secret123';

export async function setupDb(): Promise<Express> {
  await createMigrator(sequelize).up();
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['security_events', 'signing_keys', 'invites', 'users', 'tenants']) await sequelize.query(`TRUNCATE TABLE ${t}`);
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  // ioredis does not prefix the KEYS pattern but does prefix DEL, so match + strip explicitly.
  const prefix = process.env.REDIS_PREFIX ?? '';
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys.map((k) => k.slice(prefix.length)));
  await keyStore.init();
  return createApp();
}

export async function teardown() {
  keyStore.stop();
  await sequelize.close();
  await redis.quit();
}

export async function seedTenant(slug: string) {
  const tenant = await Tenant.create({ name: `Agency ${slug}`, slug });
  const passwordHash = await hashPassword(PASSWORD);
  const admin = await User.create({ tenantId: tenant.id, email: `admin@${slug}.test`, name: 'Admin', passwordHash, role: 'ADMIN' });
  const agent = await User.create({ tenantId: tenant.id, email: `agent@${slug}.test`, name: 'Agent', passwordHash, role: 'AGENT' });
  return { tenant, admin, agent };
}

export async function seedSuperAdmin() {
  return User.create({ tenantId: null, email: 'root@platform.test', name: 'Root', passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN' });
}

/** Extracts the raw refresh token from Set-Cookie. */
export function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((s) => s.startsWith('pf_rt='));
  const value = c?.split(';')[0].slice('pf_rt='.length);
  return value ? decodeURIComponent(value) : undefined;
}

export const cookieHeader = (rt: string) => `pf_rt=${encodeURIComponent(rt)}`;

export async function login(app: Express, email: string, password = PASSWORD, ip = '10.0.0.1') {
  return request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password });
}
