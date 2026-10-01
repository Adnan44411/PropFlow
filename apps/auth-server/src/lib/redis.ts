import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

export function createRedis(name: string): Redis {
  const client = new Redis(config.REDIS_URL, {
    keyPrefix: config.REDIS_PREFIX || undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    family: 0, // Railway private networking is IPv6
  });
  client.on('error', (err) => logger.error('redis error', { client: name, err: err.message }));
  return client;
}

export const redis = createRedis('main');
