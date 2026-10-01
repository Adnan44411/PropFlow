import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_CRM_DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/crm_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
process.env.REDIS_PREFIX = 'test:crm:';
process.env.CRON_ENABLED = 'false';
process.env.JWKS_MIN_REFETCH_MS = '0';
process.env.AUTH_JWKS_URL = `http://127.0.0.1:${process.env.TEST_JWKS_PORT ?? '45999'}/.well-known/jwks.json`;
process.env.WEB_ORIGIN = 'http://localhost:5173';

// Two key pairs: key1 is published from the start, key2 only after a simulated rotation.
for (const name of ['TEST_KEY1', 'TEST_KEY2']) {
  if (!process.env[name]) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env[name] = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
}
