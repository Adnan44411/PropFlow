import { config } from '../config';
import { AppError } from '../lib/errors';
import { redis } from '../lib/redis';

const key = (ip: string, email: string) => `rl:login:${ip}:${email.toLowerCase()}`;

/** Throws 429 with Retry-After while the ip+email pair is locked out. */
export async function assertNotLocked(ip: string, email: string): Promise<void> {
  const k = key(ip, email);
  const [count, ttl] = await Promise.all([redis.get(k), redis.ttl(k)]);
  if (Number(count ?? 0) >= config.LOGIN_MAX_FAILURES) {
    const retryAfter = Math.max(ttl, 1);
    throw new AppError(
      429,
      'RATE_LIMITED',
      `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} min.`,
      { retryAfter },
      {
        'Retry-After': String(retryAfter),
      },
    );
  }
}

/** Records a failure; returns remaining attempts (0 means now locked) and the lock TTL. */
export async function recordFailure(ip: string, email: string): Promise<{ remaining: number; retryAfter: number }> {
  const k = key(ip, email);
  const [[, count]] = (await redis.multi().incr(k).exec()) as [[null, number]];
  if (count === 1 || (await redis.ttl(k)) < 0) await redis.expire(k, config.LOGIN_LOCKOUT_SECONDS);
  if (count >= config.LOGIN_MAX_FAILURES) await redis.expire(k, config.LOGIN_LOCKOUT_SECONDS);
  const ttl = await redis.ttl(k);
  return { remaining: Math.max(config.LOGIN_MAX_FAILURES - count, 0), retryAfter: Math.max(ttl, 1) };
}

export async function clearFailures(ip: string, email: string): Promise<void> {
  await redis.del(key(ip, email));
}
