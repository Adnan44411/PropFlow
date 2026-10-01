import { Sequelize } from 'sequelize';
import { config } from '../config';
import { logger } from './logger';

export const sequelize = new Sequelize(config.DATABASE_URL, {
  dialect: 'mysql',
  timezone: '+00:00', // everything is stored in UTC
  logging: (sql, ms) => logger.debug('sql', { sql: sql.slice(0, 500), ms }),
  benchmark: true,
  pool: { max: 15, min: 0, idle: 10_000, acquire: 20_000 },
  define: { underscored: true, timestamps: true },
  dialectOptions: { supportBigNumbers: true, bigNumberStrings: false, decimalNumbers: true },
});
