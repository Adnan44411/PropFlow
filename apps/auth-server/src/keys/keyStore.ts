import crypto, { KeyObject } from 'node:crypto';
import { Op } from 'sequelize';
import { config } from '../config';
import { decrypt, encrypt } from '../lib/crypto';
import { logger } from '../lib/logger';
import { SigningKey } from '../models';

export interface PublicJwk {
  kty: 'RSA';
  n: string;
  e: string;
  kid: string;
  alg: 'RS256';
  use: 'sig';
}

interface LoadedKey {
  kid: string;
  publicKey: KeyObject;
  privateKey: KeyObject | null;
  jwk: PublicJwk;
  createdAt: Date;
  retiredAt: Date | null;
  source: 'env' | 'rotated';
}

/** Accepts a PEM (literal "\n" allowed) or a base64-encoded PEM. */
export function parsePrivateKey(raw: string): KeyObject {
  const text = raw.includes('-----BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  const key = crypto.createPrivateKey(text);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('JWT_PRIVATE_KEY must be an RSA key');
  return key;
}

/** RFC 7638 JWK thumbprint → stable, content-derived kid. */
export function thumbprintKid(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { e: string; n: string };
  const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
  return crypto.createHash('sha256').update(canonical).digest('base64url').slice(0, 32);
}

function toJwk(kid: string, publicKey: KeyObject): PublicJwk {
  const jwk = publicKey.export({ format: 'jwk' }) as { e: string; n: string };
  return { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' };
}

/**
 * The auth-server is the only holder of private keys.
 * - The bootstrap key comes from env (JWT_PRIVATE_KEY) and is never stored.
 * - Keys created by /admin/rotate-keys are stored AES-256-GCM encrypted with KEY_ENCRYPTION_KEY
 *   so every auth-server instance (and restarts) can sign with them.
 * - The newest non-retired key signs. Retired keys stay in JWKS for RETIRED_KEY_GRACE_SECONDS
 *   so tokens they signed keep verifying in crm-api without a restart.
 */
class KeyStore {
  private keys = new Map<string, LoadedKey>();
  private envKey: { kid: string; privateKey: KeyObject; publicKey: KeyObject } | null = null;
  private timer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    const privateKey = parsePrivateKey(config.JWT_PRIVATE_KEY);
    const publicKey = crypto.createPublicKey(privateKey);
    const kid = thumbprintKid(publicKey);
    this.envKey = { kid, privateKey, publicKey };

    const existing = await SigningKey.findByPk(kid);
    if (!existing) {
      const anyActive = await SigningKey.count({ where: { retiredAt: null } });
      await SigningKey.create({
        kid,
        publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateEnc: null,
        source: 'env',
        // If rotated keys already exist, the env key joins as retired-but-verifiable.
        retiredAt: anyActive > 0 ? new Date() : null,
      });
      logger.info('registered bootstrap signing key from env', { kid });
    }
    await this.reload();
    if (!this.timer && config.KEY_RELOAD_INTERVAL_MS > 0) {
      this.timer = setInterval(() => {
        this.reload().catch((err) => logger.error('key reload failed', { err }));
      }, config.KEY_RELOAD_INTERVAL_MS);
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reload(): Promise<void> {
    const cutoff = new Date(Date.now() - config.RETIRED_KEY_GRACE_SECONDS * 1000);
    const rows = await SigningKey.findAll({
      where: { [Op.or]: [{ retiredAt: null }, { retiredAt: { [Op.gt]: cutoff } }] },
      order: [['createdAt', 'DESC']],
    });
    const next = new Map<string, LoadedKey>();
    for (const row of rows) {
      const publicKey = crypto.createPublicKey(row.publicPem);
      let privateKey: KeyObject | null = null;
      if (row.source === 'env' && this.envKey?.kid === row.kid) privateKey = this.envKey.privateKey;
      else if (row.privateEnc && config.KEY_ENCRYPTION_KEY && !row.retiredAt) {
        try {
          privateKey = crypto.createPrivateKey(decrypt(row.privateEnc, config.KEY_ENCRYPTION_KEY));
        } catch (err) {
          logger.error('cannot decrypt signing key; check KEY_ENCRYPTION_KEY', { kid: row.kid });
        }
      }
      next.set(row.kid, {
        kid: row.kid,
        publicKey,
        privateKey,
        jwk: toJwk(row.kid, publicKey),
        createdAt: row.createdAt,
        retiredAt: row.retiredAt ?? null,
        source: row.source,
      });
    }
    this.keys = next;
  }

  /** Newest active key that we hold the private half of. */
  signingKey(): { kid: string; privateKey: KeyObject } {
    const candidates = [...this.keys.values()].filter((k) => !k.retiredAt && k.privateKey).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const key = candidates[0];
    if (!key || !key.privateKey) throw new Error('No active signing key available');
    return { kid: key.kid, privateKey: key.privateKey };
  }

  publicKeyFor(kid: string): KeyObject | null {
    return this.keys.get(kid)?.publicKey ?? null;
  }

  jwks(): { keys: PublicJwk[] } {
    return { keys: [...this.keys.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((k) => k.jwk) };
  }

  list() {
    const signing = (() => {
      try {
        return this.signingKey().kid;
      } catch {
        return null;
      }
    })();
    return [...this.keys.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((k) => ({
        kid: k.kid,
        alg: 'RS256',
        source: k.source,
        createdAt: k.createdAt,
        retiredAt: k.retiredAt,
        signing: k.kid === signing,
        publishedUntil: k.retiredAt ? new Date(k.retiredAt.getTime() + config.RETIRED_KEY_GRACE_SECONDS * 1000) : null,
      }));
  }

  /** Creates a new key pair, makes it the signer and retires (but keeps publishing) the old ones. */
  async rotate(): Promise<{ kid: string; retired: string[] }> {
    if (!config.KEY_ENCRYPTION_KEY) {
      throw new Error('KEY_ENCRYPTION_KEY must be set to rotate keys');
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = thumbprintKid(publicKey);
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const retired: string[] = [];
    await SigningKey.sequelize!.transaction(async (transaction) => {
      const active = await SigningKey.findAll({ where: { retiredAt: null }, transaction, lock: transaction.LOCK.UPDATE });
      for (const row of active) {
        row.retiredAt = new Date();
        await row.save({ transaction });
        retired.push(row.kid);
      }
      await SigningKey.create(
        {
          kid,
          publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          privateEnc: encrypt(privatePem, config.KEY_ENCRYPTION_KEY!),
          source: 'rotated',
          retiredAt: null,
        },
        { transaction },
      );
    });
    await this.reload();
    logger.warn('signing keys rotated', { kid, retired });
    return { kid, retired };
  }
}

export const keyStore = new KeyStore();
