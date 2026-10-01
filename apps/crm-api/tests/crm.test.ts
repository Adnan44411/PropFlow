import type http from 'node:http';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { acquireJobLock } from '../src/jobs/lock';
import { sendVisitReminders, tagStaleListings } from '../src/jobs';
import { sequelize } from '../src/lib/db';
import { Property } from '../src/models';
import { bearer, closeAll, masterIds, propertyBody, publishKey2, resetDb, startJwksServer, startServer, tokenFor, USERS } from './helpers';

let jwks: http.Server;
let srv: Awaited<ReturnType<typeof startServer>>;
let app: Parameters<typeof request>[0];

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

type TestUser = { id: number; tenantId: number | null; role: string; name: string };

async function create(user: TestUser, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/properties')
    .set('Authorization', bearer(user))
    .send(await propertyBody(user.tenantId!, overrides));
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; version: number; priceInr: number };
}

beforeAll(async () => {
  jwks = await startJwksServer();
  await resetDb();
  srv = await startServer();
  app = srv.app;
});
afterAll(() => closeAll({ server: srv.server, sockets: srv.sockets, jwks }));

describe('authentication pipeline', () => {
  it('401 without a token, 401 TOKEN_EXPIRED for an expired one', async () => {
    expect((await request(app).get('/properties')).status).toBe(401);
    const expired = await request(app)
      .get('/properties')
      .set('Authorization', bearer(USERS.managerA, { expiresIn: -10 }));
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('H5 (crm side): a token signed with a newly rotated key is accepted without restart (unknown kid → JWKS refetch)', async () => {
    publishKey2();
    const res = await request(app)
      .get('/properties')
      .set('Authorization', bearer(USERS.managerA, { key: 'key2' }));
    expect(res.status).toBe(200);
    // …and tokens from the old key keep working.
    expect(
      (
        await request(app)
          .get('/properties')
          .set('Authorization', bearer(USERS.managerA, { key: 'key1' }))
      ).status,
    ).toBe(200);
  });

  it('SUPER_ADMIN cannot read tenant data but gets counts', async () => {
    expect((await request(app).get('/properties').set('Authorization', bearer(USERS.superAdmin))).status).toBe(403);
    const stats = await request(app).get('/platform/tenant-stats').set('Authorization', bearer(USERS.superAdmin));
    expect(stats.status).toBe(200);
    expect(Object.keys(stats.body.data[0] ?? { tenantId: 1, properties: 0, activeProperties: 0, closedProperties: 0 }).sort()).toEqual([
      'activeProperties',
      'closedProperties',
      'properties',
      'tenantId',
    ]);
  });
});

describe('H1 tenant isolation', () => {
  it('tenant B gets 404 on tenant A property via REST, and 0 rows via list/export filters', async () => {
    const p = await create(USERS.riya);
    const asB = bearer(USERS.managerB);
    expect((await request(app).get(`/properties/${p.id}`).set('Authorization', asB)).status).toBe(404);
    expect((await request(app).patch(`/properties/${p.id}`).set('Authorization', asB).send({ version: 1, title: 'hijack' })).status).toBe(404);
    expect((await request(app).delete(`/properties/${p.id}`).set('Authorization', asB)).status).toBe(404);
    expect((await request(app).get(`/properties/${p.id}/messages`).set('Authorization', asB)).status).toBe(404);
    const list = await request(app).get('/properties?q=Test%20Towers').set('Authorization', asB);
    expect(list.body.total).toBe(0);

    const exp = await request(app).get('/properties/export?q=Test%20Towers').set('Authorization', asB).buffer(true).parse(binary);
    expect(exp.status).toBe(200);
    expect(exp.headers['x-total-count']).toBe('0');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exp.body as unknown as ArrayBuffer);
    expect(wb.worksheets[0].actualRowCount).toBe(1); // header only
  });

  it('tenant B cannot join a tenant A property room over Socket.IO', async () => {
    const p = await create(USERS.riya);
    const socket = ioClient(srv.url, { auth: { token: tokenFor(USERS.managerB) }, transports: ['websocket'], forceNew: true });
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const ack = await socket.emitWithAck('property:join', { propertyId: p.id });
    expect(ack).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    socket.close();
  });

  it('a socket handshake without a valid token is rejected', async () => {
    const socket = ioClient(srv.url, { auth: { token: 'garbage' }, transports: ['websocket'], forceNew: true, reconnection: false });
    const err = await new Promise<Error>((r) => socket.on('connect_error', (e) => r(e)));
    expect(err.message).toBe('INVALID_TOKEN');
    socket.close();
  });
});

describe('H2 agent ownership + RBAC', () => {
  it('an AGENT gets 404 for a property assigned to someone else, and the list only shows own listings', async () => {
    const p = await create(USERS.riya);
    expect((await request(app).get(`/properties/${p.id}`).set('Authorization', bearer(USERS.kabir))).status).toBe(404);
    expect((await request(app).get(`/properties/${p.id}`).set('Authorization', bearer(USERS.riya))).status).toBe(200);
    const list = await request(app).get('/properties?pageSize=100').set('Authorization', bearer(USERS.kabir));
    expect(list.body.data.every((x: { assignee: { id: number } }) => x.assignee.id === USERS.kabir.id)).toBe(true);
  });

  it('AGENT: export 403, bulk 403, dashboard 403, admin screens 403, agent filter 403', async () => {
    const a = bearer(USERS.riya);
    expect((await request(app).get('/properties/export').set('Authorization', a)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/properties/bulk')
          .set('Authorization', a)
          .send({ action: 'reassign', ids: [1], assigneeId: 4 })
      ).status,
    ).toBe(403);
    expect((await request(app).get('/dashboard?from=2026-01-01&to=2026-01-31').set('Authorization', a)).status).toBe(403);
    expect((await request(app).post('/master-data/types').set('Authorization', a).send({ name: 'X' })).status).toBe(403);
    const users = await request(app).get('/users').set('Authorization', a);
    expect(users.status).toBe(403);
    expect(users.body.error.code).toBe('FORBIDDEN_ROLE');
    expect((await request(app).get('/properties?assignee=5').set('Authorization', a)).status).toBe(403);
  });

  it('an AGENT always creates listings assigned to themselves', async () => {
    const res = await request(app)
      .post('/properties')
      .set('Authorization', bearer(USERS.riya))
      .send(await propertyBody(1, { assigneeId: USERS.kabir.id }));
    expect(res.status).toBe(403);
    const ok = await create(USERS.riya);
    const detail = await request(app).get(`/properties/${ok.id}`).set('Authorization', bearer(USERS.managerA));
    expect(detail.body.assignee.id).toBe(USERS.riya.id);
  });
});

describe('owner phone masking', () => {
  it('is unmasked for the assignee and staff, masked in the serializer for a non-assigned agent', async () => {
    const p = await create(USERS.riya, { ownerPhone: '9830012321' });
    expect((await request(app).get(`/properties/${p.id}`).set('Authorization', bearer(USERS.riya))).body.ownerPhone).toBe('9830012321');
    expect((await request(app).get(`/properties/${p.id}`).set('Authorization', bearer(USERS.managerA))).body.ownerPhone).toBe('9830012321');

    // The manager schedules a visit on Riya's listing for Kabir: Kabir sees the visit, phone masked.
    const visit = await request(app)
      .post('/site-visits')
      .set('Authorization', bearer(USERS.managerA))
      .send({ propertyId: p.id, visitAt: '2030-01-01T05:00:00Z', agentId: USERS.kabir.id });
    expect(visit.status).toBe(201);
    const kabirVisits = await request(app).get('/site-visits').set('Authorization', bearer(USERS.kabir));
    const v = kabirVisits.body.data.find((x: { id: number }) => x.id === visit.body.id);
    expect(v.property.ownerPhone).toBe('98300 •••21');
    expect(v.property.ownerPhoneMasked).toBe(true);
  });
});

describe('H6 optimistic locking', () => {
  it('second save with a stale version → 409 VERSION_CONFLICT with the current server copy', async () => {
    const p = await create(USERS.riya);
    const tab1 = await request(app).patch(`/properties/${p.id}`).set('Authorization', bearer(USERS.riya)).send({ version: 1, priceInr: 11_000_000 });
    expect(tab1.status).toBe(200);
    expect(tab1.body.version).toBe(2);
    const tab2 = await request(app).patch(`/properties/${p.id}`).set('Authorization', bearer(USERS.managerA)).send({ version: 1, priceInr: 10_500_000 });
    expect(tab2.status).toBe(409);
    expect(tab2.body.error.code).toBe('VERSION_CONFLICT');
    expect(tab2.body.error.details.current).toMatchObject({ id: p.id, version: 2, priceInr: 11_000_000 });

    const activity = await request(app).get(`/properties/${p.id}/activity`).set('Authorization', bearer(USERS.riya));
    const upd = activity.body.data.find((a: { action: string }) => a.action === 'UPDATED');
    expect(upd.diff.priceInr).toMatchObject({ from: 12_500_000, to: 11_000_000 });
  });

  it('PATCH without version → 400', async () => {
    const p = await create(USERS.riya);
    const res = await request(app).patch(`/properties/${p.id}`).set('Authorization', bearer(USERS.riya)).send({ title: 'No version here' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.version).toBeDefined();
  });
});

describe('H7 duplicate listing', () => {
  it('two parallel POSTs with the same building + unit → exactly one 201 and one 409', async () => {
    const body = await propertyBody(1, { buildingName: 'Race Residency', unitNo: '1201' });
    const [a, b] = await Promise.all([
      request(app).post('/properties').set('Authorization', bearer(USERS.riya)).send(body),
      request(app).post('/properties').set('Authorization', bearer(USERS.kabir)).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(conflict.body.error.code).toBe('DUPLICATE_LISTING');
    expect(await Property.count({ where: { buildingName: 'Race Residency', unitNo: '1201' } })).toBe(1);
  });

  it('check-duplicate endpoint powers the inline form warning', async () => {
    const res = await request(app).get('/properties/check-duplicate?buildingName=Race%20Residency&unitNo=1201').set('Authorization', bearer(USERS.managerA));
    expect(res.body.duplicate).toBe(true);
  });
});

describe('bulk actions', () => {
  it('reassigns atomically and rolls back everything when one id is bad', async () => {
    const ids = [(await create(USERS.riya)).id, (await create(USERS.riya)).id];
    const bad = await request(app)
      .post('/properties/bulk')
      .set('Authorization', bearer(USERS.managerA))
      .send({ action: 'reassign', ids: [...ids, 999_999], assigneeId: USERS.kabir.id });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.missingIds).toEqual([999_999]);
    const still = await Property.findAll({ where: { id: ids } });
    expect(still.every((p) => p.assigneeId === USERS.riya.id && p.version === 1)).toBe(true);

    const ok = await request(app)
      .post('/properties/bulk')
      .set('Authorization', bearer(USERS.managerA))
      .send({ action: 'reassign', ids, assigneeId: USERS.kabir.id });
    expect(ok.status).toBe(200);
    expect(ok.body.affected).toBe(2);
    const after = await Property.findAll({ where: { id: ids } });
    expect(after.every((p) => p.assigneeId === USERS.kabir.id && p.version === 2)).toBe(true);
  });

  it('a tenant B id inside a tenant A bulk request is treated as missing (no cross-tenant write)', async () => {
    const mine = await create(USERS.riya);
    const theirs = await create(USERS.agentB);
    const res = await request(app)
      .post('/properties/bulk')
      .set('Authorization', bearer(USERS.managerA))
      .send({ action: 'reassign', ids: [mine.id, theirs.id], assigneeId: USERS.kabir.id });
    expect(res.status).toBe(422);
    expect((await Property.findByPk(theirs.id))!.assigneeId).toBe(USERS.agentB.id);
  });
});

describe('H10 master-data cache invalidation', () => {
  it('renaming a locality shows the new name in the property list immediately', async () => {
    const p = await create(USERS.riya);
    const { localities } = await masterIds(1);
    const before = await request(app).get(`/properties/${p.id}`).set('Authorization', bearer(USERS.managerA));
    expect(before.body.locality.name).toBe(localities[0].name); // cache is now warm
    const rename = await request(app)
      .patch(`/master-data/localities/${localities[0].id}`)
      .set('Authorization', bearer(USERS.adminA))
      .send({ name: 'Renamed Nagar' });
    expect(rename.status).toBe(200);
    const list = await request(app).get('/properties?pageSize=100').set('Authorization', bearer(USERS.managerA));
    const row = list.body.data.find((x: { id: number }) => x.id === p.id);
    expect(row.locality.name).toBe('Renamed Nagar');
  });

  it('an in-use item cannot be deleted (422 IN_USE) but can be deactivated', async () => {
    const { types } = await masterIds(1);
    const del = await request(app).delete(`/master-data/types/${types[0].id}`).set('Authorization', bearer(USERS.adminA));
    expect(del.status).toBe(422);
    expect(del.body.error.code).toBe('IN_USE');
    const deact = await request(app).patch(`/master-data/types/${types[0].id}`).set('Authorization', bearer(USERS.adminA)).send({ isActive: false });
    expect(deact.body.isActive).toBe(false);
    await request(app).patch(`/master-data/types/${types[0].id}`).set('Authorization', bearer(USERS.adminA)).send({ isActive: true });
  });
});

describe('H8 chat idempotency + real-time', () => {
  it('socket chat:send persists before broadcast; a retry with the same client_msg_id creates exactly one message', async () => {
    const p = await create(USERS.riya);
    const riya = ioClient(srv.url, { auth: { token: tokenFor(USERS.riya) }, transports: ['websocket'], forceNew: true });
    const manager = ioClient(srv.url, { auth: { token: tokenFor(USERS.managerA) }, transports: ['websocket'], forceNew: true });
    await Promise.all([riya, manager].map((s: Socket) => new Promise<void>((r) => s.on('connect', () => r()))));
    expect(await riya.emitWithAck('property:join', { propertyId: p.id })).toMatchObject({ ok: true });
    expect(await manager.emitWithAck('property:join', { propertyId: p.id })).toMatchObject({ ok: true });

    const received: unknown[] = [];
    manager.on('chat:new', (m) => received.push(m));
    const typing = new Promise((r) => manager.on('typing', r));
    riya.emit('typing', { propertyId: p.id, isTyping: true });
    expect(await typing).toMatchObject({ propertyId: p.id, isTyping: true, user: { id: USERS.riya.id } });

    const msg = { propertyId: p.id, clientMsgId: 'msg-00000001', body: 'Owner confirmed Saturday 11 AM' };
    const first = await riya.emitWithAck('chat:send', msg);
    const retry = await riya.emitWithAck('chat:send', msg);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(retry).toMatchObject({ ok: true, duplicate: true, id: first.id });

    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(1);
    const history = await request(app).get(`/properties/${p.id}/messages`).set('Authorization', bearer(USERS.riya));
    expect(history.body.data.filter((m: { clientMsgId: string }) => m.clientMsgId === 'msg-00000001')).toHaveLength(1);
    riya.close();
    manager.close();
  });

  it('an agent reassigned away from a listing is removed from its chat room', async () => {
    const p = await create(USERS.riya);
    const riya = ioClient(srv.url, { auth: { token: tokenFor(USERS.riya) }, transports: ['websocket'], forceNew: true });
    await new Promise<void>((r) => riya.on('connect', () => r()));
    expect(await riya.emitWithAck('property:join', { propertyId: p.id })).toMatchObject({ ok: true });
    const leaked: unknown[] = [];
    riya.on('chat:new', (m) => leaked.push(m));

    const moved = await request(app).patch(`/properties/${p.id}`).set('Authorization', bearer(USERS.managerA)).send({ version: 1, assigneeId: USERS.kabir.id });
    expect(moved.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    await request(app)
      .post(`/properties/${p.id}/messages`)
      .set('Authorization', bearer(USERS.managerA))
      .send({ clientMsgId: 'after-move-01', body: 'private to the new agent' });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toHaveLength(0);
    expect(await riya.emitWithAck('property:join', { propertyId: p.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    riya.close();
  });

  it('REST fallback is idempotent too (201 then 200)', async () => {
    const p = await create(USERS.riya);
    const body = { clientMsgId: 'rest-0000001', body: 'hello' };
    const a = await request(app).post(`/properties/${p.id}/messages`).set('Authorization', bearer(USERS.riya)).send(body);
    const b = await request(app).post(`/properties/${p.id}/messages`).set('Authorization', bearer(USERS.riya)).send(body);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.message.id).toBe(a.body.message.id);
  });
});

describe('H12 time zones, reminders, cron locks', () => {
  it('a visit at 10:00 IST is stored and returned as 04:30 UTC', async () => {
    const p = await create(USERS.riya);
    const res = await request(app)
      .post('/site-visits')
      .set('Authorization', bearer(USERS.riya))
      .send({ propertyId: p.id, visitAt: '2030-10-01T10:00:00+05:30' });
    expect(res.status).toBe(201);
    expect(res.body.visitAt).toBe('2030-10-01T04:30:00.000Z');
    const [[row]] = (await sequelize.query(`SELECT DATE_FORMAT(visit_at_utc, '%Y-%m-%d %H:%i') AS v FROM site_visits WHERE id = ${res.body.id}`)) as [
      Array<{ v: string }>,
      unknown,
    ];
    expect(row.v).toBe('2030-10-01 04:30');
    const moved = await request(app).patch(`/site-visits/${res.body.id}`).set('Authorization', bearer(USERS.riya)).send({ visitAt: '2030-10-02T06:00:00Z' });
    expect(moved.body.visitAt).toBe('2030-10-02T06:00:00.000Z');
  });

  it('reminder fires exactly once for a visit within the next 15 minutes', async () => {
    const p = await create(USERS.riya);
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    await request(app).post('/site-visits').set('Authorization', bearer(USERS.riya)).send({ propertyId: p.id, visitAt: soon });
    const first = await sendVisitReminders();
    const second = await sendVisitReminders();
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(second.reminded).toBe(0);
  });

  it('only one instance acquires the cron lock per tick', async () => {
    expect(await acquireJobLock('test-job')).toBe(true);
    expect(await acquireJobLock('test-job')).toBe(false);
  });

  it('nightly job tags listings with no activity for 30 days as stale', async () => {
    const p = await create(USERS.riya);
    await sequelize.query(`UPDATE properties SET last_activity_at = UTC_TIMESTAMP() - INTERVAL 40 DAY WHERE id = ${p.id}`);
    const res = await tagStaleListings();
    expect(res.tagged).toBeGreaterThanOrEqual(1);
    expect((await Property.findByPk(p.id))!.isStale).toBe(true);
  });
});

describe('list, dashboard, health', () => {
  it('server-side pagination, sorting and validation', async () => {
    const res = await request(app)
      .get('/properties?page=1&pageSize=2&sortBy=priceInr&sortOrder=asc&listingType=SALE')
      .set('Authorization', bearer(USERS.managerA));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThan(2);
    const prices = res.body.data.map((x: { priceInr: number }) => x.priceInr);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect((await request(app).get('/properties?pageSize=500').set('Authorization', bearer(USERS.managerA))).status).toBe(400);
  });

  it('dashboard returns KPIs + 4 chart series and is cached', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const q = `/dashboard?from=${today}&to=${today}`;
    const a = await request(app).get(q).set('Authorization', bearer(USERS.managerA));
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      kpis: expect.any(Object),
      listingsOverTime: expect.any(Array),
      funnel: expect.any(Array),
      typeSplit: expect.any(Array),
      topAgents: expect.any(Array),
    });
    expect(a.body.funnel.map((f: { name: string }) => f.name)).toEqual(['Draft', 'Listed', 'Site Visit', 'Negotiation', 'Closed']);
    const b = await request(app).get(q).set('Authorization', bearer(USERS.managerA));
    expect(b.body.cached).toBe(true);
  });

  it('health reports MySQL, Redis and JWKS', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.checks).toMatchObject({ mysql: { status: 'up' }, redis: { status: 'up' }, jwks: { status: 'up' } });
  });
});
