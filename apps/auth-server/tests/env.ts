import crypto from 'node:crypto';

/** Runs before any module is imported: configure a throwaway key and the test databases. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_AUTH_DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/auth_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
process.env.REDIS_PREFIX = 'test:auth:';
if (!process.env.JWT_PRIVATE_KEY) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64');
}
process.env.KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.KEY_RELOAD_INTERVAL_MS = '0';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';
process.env.BCRYPT_ROUNDS = '4';
process.env.ACCESS_TOKEN_TTL_SECONDS = '60';
process.env.WEB_ORIGIN = 'http://localhost:5173';
