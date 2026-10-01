import crypto, { KeyObject } from 'node:crypto';
import { config } from '../config';
import { logger } from './logger';
import { redis } from './redis';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

/**
 * crm-api never sees a private key. It verifies RS256 tokens with public keys from the
 * auth-server JWKS:
 *  - in-memory map + Redis key `jwks` (TTL 10 min) shared by all crm-api instances;
 *  - an unknown `kid` (e.g. right after key rotation) forces a refetch from auth-server,
 *    throttled to one per JWKS_MIN_REFETCH_MS so garbage kids cannot hammer the auth-server.
 */
export class JwksClient {
  private keys = new Map<string, KeyObject>();
  private loadedAt = 0;
  private lastForcedFetch = 0;
  private inflight: Promise<void> | null = null;
  lastError: string | null = null;
  lastFetchedAt: Date | null = null;

  constructor(
    private readonly url: string,
    private readonly ttlSeconds: number,
  ) {}

  private ingest(jwks: { keys: Jwk[] }) {
    const next = new Map<string, KeyObject>();
    for (const k of jwks.keys ?? []) {
      if (k.kty !== 'RSA' || !k.kid) continue;
      next.set(k.kid, crypto.createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' }));
    }
    this.keys = next;
    this.loadedAt = Date.now();
  }

  private async fetchRemote(): Promise<void> {
    const res = await fetch(this.url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { keys: Jwk[] };
    this.ingest(body);
    this.lastFetchedAt = new Date();
    this.lastError = null;
    await redis.set('jwks', JSON.stringify(body), 'EX', this.ttlSeconds).catch(() => undefined);
    logger.info('jwks refreshed from auth-server', { kids: [...this.keys.keys()] });
  }

  private async load(force: boolean): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        if (!force) {
          const cached = await redis.get('jwks').catch(() => null);
          if (cached) {
            this.ingest(JSON.parse(cached));
            return;
          }
        }
        await this.fetchRemote();
      } catch (err) {
        this.lastError = (err as Error).message;
        logger.error('jwks load failed', { err: this.lastError });
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  async getKey(kid: string): Promise<KeyObject | null> {
    if (Date.now() - this.loadedAt > this.ttlSeconds * 1000) await this.load(false);
    let key = this.keys.get(kid);
    if (!key && Date.now() - this.lastForcedFetch > config.JWKS_MIN_REFETCH_MS) {
      this.lastForcedFetch = Date.now();
      await this.load(true);
      key = this.keys.get(kid);
    }
    return key ?? null;
  }

  async warm(): Promise<void> {
    await this.load(false);
  }

  status() {
    return {
      status: this.keys.size > 0 ? ('up' as const) : ('down' as const),
      kids: [...this.keys.keys()],
      cacheAgeSeconds: this.loadedAt ? Math.round((Date.now() - this.loadedAt) / 1000) : null,
      lastFetchedAt: this.lastFetchedAt,
      lastError: this.lastError,
    };
  }

  /** Health check: make sure we can still reach the JWKS (uses cache when fresh). */
  async check(): Promise<ReturnType<JwksClient['status']>> {
    if (this.keys.size === 0 || Date.now() - this.loadedAt > this.ttlSeconds * 1000) await this.load(false);
    return this.status();
  }
}

export const jwksClient = new JwksClient(config.jwksUrl, config.JWKS_CACHE_SECONDS);
