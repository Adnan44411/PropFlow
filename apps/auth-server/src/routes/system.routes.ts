import { Router } from 'express';
import { sequelize } from '../lib/db';
import { redis } from '../lib/redis';
import { keyStore } from '../keys/keyStore';

export const systemRouter = Router();

/** Public keys. crm-api caches this and refetches on an unknown kid. */
systemRouter.get('/.well-known/jwks.json', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.json(keyStore.jwks());
});

async function check(fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), 2000);
    });
    await Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
    return { status: 'up' as const, latencyMs: Date.now() - started };
  } catch (err) {
    return { status: 'down' as const, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

systemRouter.get('/health', async (_req, res) => {
  const [mysql, redisCheck] = await Promise.all([check(() => sequelize.authenticate()), check(() => redis.ping())]);
  const keys = keyStore.jwks().keys.length;
  const ok = mysql.status === 'up' && redisCheck.status === 'up' && keys > 0;
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    service: 'auth-server',
    version: process.env.npm_package_version ?? '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { mysql, redis: redisCheck, signingKeys: { status: keys > 0 ? 'up' : 'down', published: keys } },
  });
});
