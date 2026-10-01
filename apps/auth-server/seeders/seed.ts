/**
 * npm run seed (auth-server part) — idempotent.
 * Creates SUPER_ADMIN + 2 tenants, each with 1 ADMIN, 1 MANAGER and 2 AGENTS (fixed ids shared with crm-api).
 * Password for every seeded account: $SEED_PASSWORD (default PropFlow@123 — documented in README).
 */
import { SEED_TENANTS, SEED_USERS } from '@propflow/shared';
import { config } from '../src/config';
import { sequelize } from '../src/lib/db';
import { redis } from '../src/lib/redis';
import { Tenant, User } from '../src/models';
import { hashPassword } from '../src/services/auth.service';
import { publishTenantCreated, publishUserUpserted } from '../src/services/events.service';

async function main() {
  const passwordHash = await hashPassword(config.SEED_PASSWORD);
  await sequelize.transaction(async (transaction) => {
    for (const t of SEED_TENANTS) {
      await Tenant.upsert({ id: t.id, name: t.name, slug: t.slug, isActive: true }, { transaction });
    }
    for (const u of SEED_USERS) {
      await User.upsert({ id: u.id, tenantId: u.tenantId, role: u.role, name: u.name, email: u.email, passwordHash, isActive: true }, { transaction });
    }
  });
  // Keep auto-increment ahead of the fixed ids.
  await sequelize.query('ALTER TABLE tenants AUTO_INCREMENT = 100');
  await sequelize.query('ALTER TABLE users AUTO_INCREMENT = 1000');

  for (const t of await Tenant.findAll()) await publishTenantCreated(t);
  for (const u of await User.findAll()) await publishUserUpserted(u);

  console.log(`auth seed done: ${SEED_TENANTS.length} tenants, ${SEED_USERS.length} users (password: SEED_PASSWORD)`);
  await sequelize.close();
  await redis.quit();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
