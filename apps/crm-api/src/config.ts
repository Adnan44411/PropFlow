import 'dotenv/config';
import os from 'node:os';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4001),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.coerce.number().int().default(1),
  INSTANCE_ID: z.string().default(`${os.hostname()}-${process.pid}`),

  DATABASE_URL: z.string().url({ message: 'DATABASE_URL is required, e.g. mysql://user:pass@host:3306/crm_db' }),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_PREFIX: z.string().default(''),

  AUTH_SERVER_URL: z.string().url().default('http://127.0.0.1:4000'),
  AUTH_JWKS_URL: z.string().url().optional(),
  JWT_ISSUER: z.string().default('propflow-auth'),
  JWT_AUDIENCE: z.string().default('propflow'),
  JWKS_CACHE_SECONDS: z.coerce.number().int().default(600),
  /** Minimum gap between forced JWKS refetches triggered by unknown kids (DoS guard). */
  JWKS_MIN_REFETCH_MS: z.coerce.number().int().default(5_000),

  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  CRON_ENABLED: bool.default('true'),
  CRON_TZ: z.string().default('Asia/Kolkata'),
  REMINDER_LEAD_MINUTES: z.coerce.number().int().default(15),
  STALE_AFTER_DAYS: z.coerce.number().int().default(30),

  EXPORT_BATCH_SIZE: z.coerce.number().int().min(100).max(5000).default(1000),
  DASHBOARD_CACHE_SECONDS: z.coerce.number().int().default(60),
  MASTER_DATA_CACHE_SECONDS: z.coerce.number().int().default(3600),
  SOCKET_PING_INTERVAL_MS: z.coerce.number().int().default(20_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  jwksUrl: parsed.data.AUTH_JWKS_URL ?? `${parsed.data.AUTH_SERVER_URL.replace(/\/$/, '')}/.well-known/jwks.json`,
  webOrigins: parsed.data.WEB_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};
