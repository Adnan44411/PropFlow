import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { config } from '../config';
import { sequelize } from '../lib/db';
import { jwksClient } from '../lib/jwks';
import { redis } from '../lib/redis';
import { UserMirror } from '../models';
import { getDashboard } from '../services/dashboard.service';
import { tenantStats } from '../services/platform.service';

export async function dashboard(req: Request, res: Response) {
  res.json(await getDashboard(req.tenantId, req.validatedQuery as { from: string; to: string; tz: string }));
}

/** Active users of the tenant for assignee pickers, agent filter and leaderboards. */
export async function team(req: Request, res: Response) {
  const rows = await UserMirror.findAll({
    where: { tenantId: req.tenantId, isActive: true, role: { [Op.in]: ['ADMIN', 'MANAGER', 'AGENT'] } },
    attributes: ['id', 'name', 'role'],
    order: [['name', 'ASC']],
  });
  res.json({ data: rows });
}

export async function platformStats(_req: Request, res: Response) {
  res.json({ data: await tenantStats() });
}

async function check(fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), 2500);
    });
    await Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
    return { status: 'up' as const, latencyMs: Date.now() - started };
  } catch (err) {
    return { status: 'down' as const, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

/** Public: MySQL, Redis and JWKS status. 503 when any dependency is down. */
export async function health(_req: Request, res: Response) {
  const [mysql, redisCheck, jwks] = await Promise.all([
    check(() => sequelize.authenticate()),
    check(() => redis.ping()),
    jwksClient.check().catch((err) => ({ status: 'down' as const, error: (err as Error).message })),
  ]);
  const ok = mysql.status === 'up' && redisCheck.status === 'up' && jwks.status === 'up';
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    service: 'crm-api',
    instance: config.INSTANCE_ID,
    version: process.env.npm_package_version ?? '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { mysql, redis: redisCheck, jwks },
  });
}
