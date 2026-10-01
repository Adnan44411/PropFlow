import crypto from 'node:crypto';
import type Redis from 'ioredis';
import { config } from '../config';
import { randomToken, sha256 } from '../lib/crypto';
import { redis as defaultRedis } from '../lib/redis';

export interface RefreshRecord {
  userId: number;
  tenantId: number | null;
  familyId: string;
  used: boolean;
  createdAt: string;
  usedAt?: string;
  ua?: string;
  ip?: string;
}

const rtKey = (hash: string) => `rt:${hash}`;
const famKey = (familyId: string) => `rtfam:${familyId}`;
const userFamKey = (userId: number) => `rtuser:${userId}`;

/**
 * Atomically consume a refresh token.
 *  returns [0]           → unknown / expired
 *  returns [-1, record]  → already used  (REUSE — caller revokes the family)
 *  returns [1, record]   → ok, now marked used (kept until TTL so a replay is detectable)
 */
const CONSUME_LUA = `
local v = redis.call('GET', KEYS[1])
if not v then return {0} end
local d = cjson.decode(v)
if d.used then return {-1, v} end
d.used = true
d.usedAt = ARGV[1]
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 1 then ttl = 1000 end
redis.call('SET', KEYS[1], cjson.encode(d), 'PX', ttl)
return {1, v}
`;

export type ConsumeResult = { status: 'invalid' } | { status: 'reused'; record: RefreshRecord } | { status: 'ok'; record: RefreshRecord };

export class RefreshTokenStore {
  constructor(private readonly r: Redis = defaultRedis) {}

  private get ttl() {
    return config.REFRESH_TOKEN_TTL_SECONDS;
  }

  /** Issue a token in a new family (login) or an existing one (rotation). Returns the raw token. */
  async issue(input: { userId: number; tenantId: number | null; familyId?: string; ua?: string; ip?: string }): Promise<{
    token: string;
    familyId: string;
  }> {
    const token = randomToken();
    const hash = sha256(token);
    const familyId = input.familyId ?? crypto.randomUUID();
    const record: RefreshRecord = {
      userId: input.userId,
      tenantId: input.tenantId,
      familyId,
      used: false,
      createdAt: new Date().toISOString(),
      ua: input.ua?.slice(0, 200),
      ip: input.ip,
    };
    await this.r
      .multi()
      .set(rtKey(hash), JSON.stringify(record), 'EX', this.ttl)
      .sadd(famKey(familyId), hash)
      .expire(famKey(familyId), this.ttl)
      .sadd(userFamKey(input.userId), familyId)
      .expire(userFamKey(input.userId), this.ttl)
      .exec();
    return { token, familyId };
  }

  async consume(token: string): Promise<ConsumeResult> {
    const res = (await this.r.eval(CONSUME_LUA, 1, rtKey(sha256(token)), new Date().toISOString())) as [number, string?];
    if (res[0] === 0 || !res[1]) return { status: 'invalid' };
    const record = JSON.parse(res[1]) as RefreshRecord;
    return res[0] === -1 ? { status: 'reused', record } : { status: 'ok', record };
  }

  async peek(token: string): Promise<RefreshRecord | null> {
    const v = await this.r.get(rtKey(sha256(token)));
    return v ? (JSON.parse(v) as RefreshRecord) : null;
  }

  /** Deletes every token of a family (logout, reuse detection). */
  async revokeFamily(familyId: string, userId?: number): Promise<number> {
    const hashes = await this.r.smembers(famKey(familyId));
    const pipeline = this.r.multi();
    for (const h of hashes) pipeline.del(rtKey(h));
    pipeline.del(famKey(familyId));
    if (userId != null) pipeline.srem(userFamKey(userId), familyId);
    await pipeline.exec();
    return hashes.length;
  }

  /** Every session of the user (logout-all, deactivation). */
  async revokeAllForUser(userId: number): Promise<number> {
    const families = await this.r.smembers(userFamKey(userId));
    for (const f of families) await this.revokeFamily(f);
    await this.r.del(userFamKey(userId));
    return families.length;
  }

  async activeFamilies(userId: number): Promise<string[]> {
    const families = await this.r.smembers(userFamKey(userId));
    const alive: string[] = [];
    for (const f of families) if (await this.r.exists(famKey(f))) alive.push(f);
    return alive;
  }
}

export const refreshStore = new RefreshTokenStore();
