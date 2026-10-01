import { sequelize } from '../lib/db';
import { createMigrator } from '../lib/migrator';

async function main() {
  const direction = process.argv[2] ?? 'up';
  const migrator = createMigrator(sequelize);
  if (direction === 'down') await migrator.down();
  else await migrator.up();
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
