import http from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { sequelize } from './lib/db';
import { jwksClient } from './lib/jwks';
import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { startJobs, stopJobs } from './jobs';
import { startIdentitySubscriber, stopIdentitySubscriber } from './services/identity.service';
import { createSocketServer } from './sockets';

async function main() {
  await sequelize.authenticate();
  await jwksClient.warm();
  await startIdentitySubscriber();

  const app = createApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  const sockets = await createSocketServer(server);
  startJobs();
  server.listen(config.PORT, () => logger.info('crm-api listening', { port: config.PORT, instance: config.INSTANCE_ID, env: config.NODE_ENV }));

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown started', { signal });
    setTimeout(() => {
      logger.error('forced shutdown after 10s');
      process.exit(1);
    }, 10_000).unref();

    stopJobs(); // no new cron ticks
    // 1) stop accepting new HTTP connections; in-flight requests keep running
    server.close(async () => {
      try {
        await stopIdentitySubscriber();
        await sequelize.close();
        await redis.quit();
        logger.info('shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error('error during shutdown', { err });
        process.exit(1);
      }
    });
    server.closeIdleConnections();
    // 2) close sockets (clients reconnect to another instance)
    sockets.close().catch((err) => logger.error('socket close failed', { err }));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { reason }));

main().catch((err) => {
  logger.error('failed to start', { err });
  process.exit(1);
});
