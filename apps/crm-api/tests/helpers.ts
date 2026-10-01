import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { SEED_TENANTS, SEED_USERS } from '@propflow/shared';
import { createApp } from '../src/app';
import { sequelize } from '../src/lib/db';
import { jwksClient } from '../src/lib/jwks';
import { createMigrator } from '../src/lib/migrator';
import { redis } from '../src/lib/redis';
import { Locality, TenantMirror, UserMirror } from '../src/models';
import { ensureTenantDefaults, getMasterData } from '../src/services/masterData.service';
import { createSocketServer } from '../src/sockets';

export const KEYS = {
  key1: { kid: 'test-key-1', pem: process.env.TEST_KEY1! },
  key2: { kid: 'test-key-2', pem: process.env.TEST_KEY2! },
};
const published = new Set<string>(['test-key-1']);
export const publishKey2 = () => published.add('test-key-2');

function jwk(kid: string, pem: string) {
  const pub = crypto.createPublicKey(pem).export({ format: 'jwk' }) as { n: string; e: string };
  return { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: pub.n, e: pub.e };
}

/** Stands in for auth-server's /.well-known/jwks.json. */
export async function startJwksServer(): Promise<http.Server> {
  const server = http.createServer((_req, res) => {
    const keys = Object.values(KEYS)
      .filter((k) => published.has(k.kid))
      .map((k) => jwk(k.kid, k.pem));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys }));
  });
  await new Promise<void>((r) => server.listen(Number(process.env.TEST_JWKS_PORT ?? 45999), '127.0.0.1', () => r()));
  return server;
}

export const USERS = {
  adminA: SEED_USERS.find((u) => u.email === 'admin@skyline.dev')!,
  managerA: SEED_USERS.find((u) => u.email === 'manager@skyline.dev')!,
  riya: SEED_USERS.find((u) => u.email === 'riya@skyline.dev')!, // agent A1
  kabir: SEED_USERS.find((u) => u.email === 'kabir@skyline.dev')!, // agent A2
  managerB: SEED_USERS.find((u) => u.email === 'manager@harbour.dev')!,
  agentB: SEED_USERS.find((u) => u.email === 'arjun@harbour.dev')!,
  superAdmin: SEED_USERS.find((u) => u.role === 'SUPER_ADMIN')!,
};

export function tokenFor(u: { id: number; tenantId: number | null; role: string; name: string }, opts: { key?: keyof typeof KEYS; expiresIn?: number } = {}) {
  const key = KEYS[opts.key ?? 'key1'];
  return jwt.sign({ tid: u.tenantId, role: u.role, name: u.name }, key.pem, {
    algorithm: 'RS256',
    keyid: key.kid,
    subject: String(u.id),
    jwtid: crypto.randomUUID(),
    issuer: 'propflow-auth',
    audience: 'propflow',
    expiresIn: opts.expiresIn ?? 300,
  });
}
export const bearer = (u: Parameters<typeof tokenFor>[0], opts?: Parameters<typeof tokenFor>[1]) => `Bearer ${tokenFor(u, opts)}`;

export async function resetDb() {
  await createMigrator(sequelize).up();
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'chat_messages',
    'site_visits',
    'property_activity',
    'property_notes',
    'property_amenities',
    'properties',
    'amenities',
    'localities',
    'property_types',
    'property_statuses',
    'users',
    'tenants',
  ]) {
    await sequelize.query(`TRUNCATE TABLE ${t}`);
  }
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  const prefix = process.env.REDIS_PREFIX!;
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys.map((k) => k.slice(prefix.length)));

  for (const t of SEED_TENANTS) await TenantMirror.create({ id: t.id, name: t.name, slug: t.slug });
  for (const u of SEED_USERS) await UserMirror.create({ id: u.id, tenantId: u.tenantId, name: u.name, email: u.email, role: u.role, isActive: true });
  for (const t of SEED_TENANTS) {
    await ensureTenantDefaults(t.id);
    await Locality.bulkCreate([
      { tenantId: t.id, name: `${t.slug} Central`, city: 'Mumbai', sortOrder: 10 },
      { tenantId: t.id, name: `${t.slug} East`, city: 'Mumbai', sortOrder: 20 },
    ]);
  }
}

export async function masterIds(tenantId: number) {
  const [types, localities, statuses, amenities] = await Promise.all([
    getMasterData(tenantId, 'types'),
    getMasterData(tenantId, 'localities'),
    getMasterData(tenantId, 'statuses'),
    getMasterData(tenantId, 'amenities'),
  ]);
  return { types, localities, statuses, amenities };
}

let unit = 100;
export async function propertyBody(tenantId: number, overrides: Record<string, unknown> = {}) {
  const m = await masterIds(tenantId);
  return {
    title: '2 BHK Apartment for sale',
    typeId: m.types[0].id,
    listingType: 'SALE',
    bhk: 2,
    furnishing: 'SEMI_FURNISHED',
    buildingName: 'Test Towers',
    unitNo: String(unit++),
    floor: 3,
    totalFloors: 12,
    localityId: m.localities[0].id,
    city: 'Mumbai',
    priceInr: 12_500_000,
    carpetAreaSqft: 700,
    ownerName: 'Owner Person',
    ownerPhone: '+91 98300 12321',
    amenityIds: [m.amenities[0].id],
    ...overrides,
  };
}

export async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  const sockets = await createSocketServer(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { app, server, sockets, url };
}

export async function closeAll(parts: { server?: http.Server; jwks?: http.Server; sockets?: { close: () => Promise<void> } }) {
  if (parts.sockets) await parts.sockets.close();
  if (parts.server) await new Promise((r) => parts.server!.close(r));
  if (parts.jwks) await new Promise((r) => parts.jwks!.close(r));
  await sequelize.close();
  await redis.quit();
  void jwksClient;
}
