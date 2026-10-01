/**
 * npm run keys:generate
 * Prints a fresh RSA-2048 private key (base64-encoded PEM, single line — paste into
 * JWT_PRIVATE_KEY) and a random KEY_ENCRYPTION_KEY. With --write it also writes them to
 * ./.keys/ (git-ignored). Nothing here is ever committed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const b64 = Buffer.from(pem).toString('base64');
const kek = crypto.randomBytes(32).toString('base64');

if (process.argv.includes('--write')) {
  const dir = path.resolve(process.cwd(), '.keys');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'jwt-private.pem'), pem, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'env.local'), `JWT_PRIVATE_KEY=${b64}\nKEY_ENCRYPTION_KEY=${kek}\n`, { mode: 0o600 });
  console.error(`Wrote ${dir}/jwt-private.pem and ${dir}/env.local`);
}

process.stdout.write(`JWT_PRIVATE_KEY=${b64}\nKEY_ENCRYPTION_KEY=${kek}\n`);
