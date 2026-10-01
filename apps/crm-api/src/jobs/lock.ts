import { config } from '../config';
import { redis } from '../lib/redis';

/**
 * Only one instance runs a job per tick: SET lock:cron:{job} <instance> NX EX 55.
 * The lock is NOT released early — it expires just before the next minute, so an instance
 * whose timer fires a few hundred ms later cannot run the same tick again.
 */
export async function acquireJobLock(job: string, ttlSeconds = 55): Promise<boolean> {
  const res = await redis.set(`lock:cron:${job}`, config.INSTANCE_ID, 'EX', ttlSeconds, 'NX');
  return res === 'OK';
}
