import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';
import { cookieHeader, login, PASSWORD, refreshCookie, seedSuperAdmin, seedTenant, setupDb, teardown } from './helpers';

let app: Express;

beforeAll(async () => {
  app = await setupDb();
  await seedTenant('alpha');
  await seedSuperAdmin();
});
afterAll(teardown);

describe('POST /auth/login', () => {
  it('returns an RS256 access token with the required claims and sets an httpOnly refresh cookie', async () => {
    const res = await login(app, 'admin@alpha.test');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined(); // never in the body
    const decoded = jwt.decode(res.body.accessToken, { complete: true })!;
    expect(decoded.header.alg).toBe('RS256');
    expect(decoded.header.kid).toBeTruthy();
    const p = decoded.payload as Record<string, unknown>;
    for (const claim of ['sub', 'tid', 'role', 'jti', 'iat', 'exp']) expect(p).toHaveProperty(claim);
    expect(p.role).toBe('ADMIN');
    expect((p.exp as number) - (p.iat as number)).toBe(60);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pf_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(refreshCookie(res)).toHaveLength(43); // 256-bit base64url
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS and remaining attempts', async () => {
    const res = await login(app, 'admin@alpha.test', 'wrong-password', '10.0.0.2');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.details.remainingAttempts).toBe(4);
  });

  it('validates the body with the one error shape', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String), details: expect.objectContaining({ fields: expect.any(Object) }) },
    });
  });

  it('locks out after 5 failures per ip+email: 429 with Retry-After, even with the right password', async () => {
    const ip = '10.9.9.9';
    for (let i = 1; i <= 4; i++) {
      const r = await login(app, 'agent@alpha.test', 'nope', ip);
      expect(r.status).toBe(401);
    }
    const fifth = await login(app, 'agent@alpha.test', 'nope', ip);
    expect(fifth.status).toBe(429);
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(800);
    const correct = await login(app, 'agent@alpha.test', PASSWORD, ip);
    expect(correct.status).toBe(429);
    expect(correct.body.error.code).toBe('RATE_LIMITED');
    // A different IP is not affected.
    expect((await login(app, 'agent@alpha.test', PASSWORD, '10.1.1.1')).status).toBe(200);
  });
});

describe('POST /auth/refresh — rotation and reuse detection', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const first = await login(app, 'admin@alpha.test');
    const rt1 = refreshCookie(first)!;
    const res = await request(app).post('/auth/refresh').set('Cookie', cookieHeader(rt1));
    expect(res.status).toBe(200);
    const rt2 = refreshCookie(res)!;
    expect(rt2).toBeDefined();
    expect(rt2).not.toEqual(rt1);
    expect(res.body.accessToken).not.toEqual(first.body.accessToken);
  });

  it('replaying a used refresh token → 401 REFRESH_REUSED and the whole family (incl. the newest token) is revoked', async () => {
    const first = await login(app, 'admin@alpha.test');
    const rt1 = refreshCookie(first)!;
    const rotated = await request(app).post('/auth/refresh').set('Cookie', cookieHeader(rt1));
    const rt2 = refreshCookie(rotated)!;

    const replay = await request(app).post('/auth/refresh').set('Cookie', cookieHeader(rt1));
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');

    const legit = await request(app).post('/auth/refresh').set('Cookie', cookieHeader(rt2));
    expect(legit.status).toBe(401); // the real session is logged out too

    const sa = await login(app, 'root@platform.test');
    const events = await request(app).get('/platform/security-events?type=REFRESH_REUSE_DETECTED').set('Authorization', `Bearer ${sa.body.accessToken}`);
    expect(events.body.data.length).toBeGreaterThanOrEqual(1);
    expect(events.body.data[0].severity).toBe('CRITICAL');
  });

  it('logout revokes the family: a stolen refresh token is useless afterwards', async () => {
    const s = await login(app, 'admin@alpha.test');
    const rt = refreshCookie(s)!;
    const out = await request(app).post('/auth/logout').set('Cookie', cookieHeader(rt));
    expect(out.status).toBe(204);
    const replay = await request(app).post('/auth/refresh').set('Cookie', cookieHeader(rt));
    expect(replay.status).toBe(401);
  });

  it('logout-all revokes every session of the user', async () => {
    const a = await login(app, 'admin@alpha.test');
    const b = await login(app, 'admin@alpha.test');
    const res = await request(app).post('/auth/logout-all').set('Authorization', `Bearer ${a.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBeGreaterThanOrEqual(2);
    for (const s of [a, b])
      expect(
        (
          await request(app)
            .post('/auth/refresh')
            .set('Cookie', cookieHeader(refreshCookie(s)!))
        ).status,
      ).toBe(401);
  });

  it('refuses cookie endpoints from a foreign Origin (CSRF guard)', async () => {
    const s = await login(app, 'admin@alpha.test');
    const res = await request(app)
      .post('/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookieHeader(refreshCookie(s)!));
    expect(res.status).toBe(403);
  });
});

describe('JWKS and key rotation', () => {
  it('publishes both keys after rotation; old and new access tokens both verify', async () => {
    const before = await request(app).get('/.well-known/jwks.json');
    expect(before.headers['cache-control']).toMatch(/max-age/);
    const oldKids = before.body.keys.map((k: { kid: string }) => k.kid);
    const oldToken = (await login(app, 'admin@alpha.test')).body.accessToken as string;

    const sa = await login(app, 'root@platform.test');
    const rotated = await request(app).post('/admin/rotate-keys').set('Authorization', `Bearer ${sa.body.accessToken}`);
    expect(rotated.status).toBe(201);

    const after = await request(app).get('/.well-known/jwks.json');
    const kids = after.body.keys.map((k: { kid: string }) => k.kid);
    expect(kids.length).toBeGreaterThanOrEqual(2);
    expect(kids).toEqual(expect.arrayContaining([...oldKids, rotated.body.kid]));

    const newToken = (await login(app, 'admin@alpha.test')).body.accessToken as string;
    expect(jwt.decode(newToken, { complete: true })!.header.kid).toBe(rotated.body.kid);
    for (const t of [oldToken, newToken]) {
      expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(200);
    }
  });

  it('only SUPER_ADMIN may rotate', async () => {
    const admin = await login(app, 'admin@alpha.test');
    const res = await request(app).post('/admin/rotate-keys').set('Authorization', `Bearer ${admin.body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('rejects an HS256 token signed with a shared secret', async () => {
    const forged = jwt.sign({ sub: '1', tid: 1, role: 'ADMIN' }, 'secret', { algorithm: 'HS256', keyid: 'x' });
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe('tenants, invites and users', () => {
  it('register-tenant creates tenant + ADMIN atomically; duplicate slug → 409', async () => {
    const body = { companyName: 'Beta Homes', slug: 'beta', adminName: 'Beta Admin', adminEmail: 'boss@beta.test', password: 'Passw0rd!' };
    const res = await request(app).post('/auth/register-tenant').send(body);
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.tenant.slug).toBe('beta');
    const dup = await request(app)
      .post('/auth/register-tenant')
      .send({ ...body, adminEmail: 'other@beta.test' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SLUG_TAKEN');
  });

  it('invite link is signed and single-use', async () => {
    const admin = await login(app, 'admin@alpha.test');
    const inv = await request(app)
      .post('/auth/invite')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ email: 'new.agent@alpha.test', name: 'New Agent', role: 'AGENT' });
    expect(inv.status).toBe(201);
    expect(inv.body.inviteUrl).toContain('/accept-invite?token=');
    const token = inv.body.inviteToken as string;
    const info = await request(app).get(`/auth/invite-info?token=${encodeURIComponent(token)}`);
    expect(info.body).toMatchObject({ email: 'new.agent@alpha.test', role: 'AGENT' });

    const accept = await request(app).post('/auth/accept-invite').send({ token, password: 'Welcome123' });
    expect(accept.status).toBe(201);
    expect(accept.body.user.role).toBe('AGENT');
    const again = await request(app).post('/auth/accept-invite').send({ token, password: 'Welcome123' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVITE_INVALID');
  });

  it('the last active ADMIN cannot be demoted or deactivated (422 LAST_ADMIN)', async () => {
    const admin = await login(app, 'admin@alpha.test');
    const me = admin.body.user.id;
    const demote = await request(app).patch(`/users/${me}`).set('Authorization', `Bearer ${admin.body.accessToken}`).send({ role: 'AGENT' });
    expect(demote.status).toBe(422);
    expect(demote.body.error.code).toBe('LAST_ADMIN');
    const deactivate = await request(app).patch(`/users/${me}`).set('Authorization', `Bearer ${admin.body.accessToken}`).send({ isActive: false });
    expect(deactivate.status).toBe(422);
  });

  it('an AGENT cannot list users (403) and an ADMIN only sees own-tenant users', async () => {
    const agent = await login(app, 'agent@alpha.test', PASSWORD, '10.7.7.7');
    expect((await request(app).get('/users').set('Authorization', `Bearer ${agent.body.accessToken}`)).status).toBe(403);
    const admin = await login(app, 'admin@alpha.test');
    const users = await request(app).get('/users').set('Authorization', `Bearer ${admin.body.accessToken}`);
    expect(users.status).toBe(200);
    expect(users.body.data.every((u: { tenantId: number }) => u.tenantId === admin.body.user.tenantId)).toBe(true);
  });

  it('SUPER_ADMIN tenant console returns counts only', async () => {
    const sa = await login(app, 'root@platform.test');
    const res = await request(app).get('/platform/tenants').set('Authorization', `Bearer ${sa.body.accessToken}`);
    expect(res.status).toBe(200);
    const alpha = res.body.data.find((t: { slug: string }) => t.slug === 'alpha');
    expect(alpha).toMatchObject({ userCount: expect.any(Number), usersByRole: expect.any(Object) });
  });

  it('health reports MySQL and Redis', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.mysql.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('up');
  });
});
