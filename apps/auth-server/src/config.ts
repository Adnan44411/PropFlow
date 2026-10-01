import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.coerce.number().int().default(1),

  DATABASE_URL: z.string().url({ message: 'DATABASE_URL is required, e.g. mysql://user:pass@host:3306/auth_db' }),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_PREFIX: z.string().default(''),

  /** PEM (with literal \n allowed) or base64-encoded PEM. Never committed. */
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required (npm run keys:generate)'),
  /** 32 bytes, base64. Encrypts private keys created by /admin/rotate-keys at rest. */
  KEY_ENCRYPTION_KEY: z.string().optional(),
  JWT_ISSUER: z.string().default('propflow-auth'),
  JWT_AUDIENCE: z.string().default('propflow'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).default(60),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(7 * 24 * 3600),
  INVITE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(24 * 3600),
  /** How long a retired key stays in JWKS / verifiable. Must be ≥ max(access TTL, invite TTL). */
  RETIRED_KEY_GRACE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(24 * 3600 + 300),
  KEY_RELOAD_INTERVAL_MS: z.coerce.number().int().default(30_000),

  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().url().default('http://localhost:5173'),

  COOKIE_NAME: z.string().default('pf_rt'),
  COOKIE_SECURE: bool.default('true'),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('none'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_PATH: z.string().default('/auth'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  LOGIN_MAX_FAILURES: z.coerce.number().int().default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce
    .number()
    .int()
    .default(15 * 60),

  SEED_PASSWORD: z.string().default('PropFlow@123'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  webOrigins: parsed.data.WEB_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};
export type Config = typeof config;
