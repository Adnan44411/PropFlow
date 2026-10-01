import crypto from 'node:crypto';

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** 256-bit opaque token, url-safe. */
export const randomToken = (): string => crypto.randomBytes(32).toString('base64url');

/** AES-256-GCM helpers for encrypting rotated private keys at rest. */
export function encrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('KEY_ENCRYPTION_KEY must be 32 bytes (base64)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
