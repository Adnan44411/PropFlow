import path from 'node:path';
import { QueryInterface, Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';

type MigrationModule = {
  up: (p: { context: QueryInterface }) => Promise<void>;
  down: (p: { context: QueryInterface }) => Promise<void>;
};

/**
 * Migrations are plain TS/JS modules in <app>/migrations. They run as a separate command
 * (`npm run migrate`), never on boot, and there is no sync({ alter }) anywhere.
 * Names are stored without extension so `tsx` (dev) and compiled JS (prod) agree.
 */
export function createMigrator(sequelize: Sequelize) {
  const dir = path.resolve(__dirname, '../../migrations');
  return new Umzug<QueryInterface>({
    migrations: {
      glob: ['*.{ts,js}', { cwd: dir, ignore: ['*.d.ts'] }],
      resolve: ({ name, path: file, context }) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(file as string) as MigrationModule;
        return {
          name: name.replace(/\.(ts|js)$/, ''),
          up: () => mod.up({ context }),
          down: () => mod.down({ context }),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName: 'schema_migrations' }),
    logger: process.env.NODE_ENV === 'test' ? undefined : console,
  });
}
