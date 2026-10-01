/**
 * npm run explain — prints EXPLAIN for the queries GET /properties issues most often
 * (used for DECISIONS.md §3). Run after `npm run seed`.
 */
import { QueryTypes } from 'sequelize';
import { sequelize } from '../lib/db';

const CASES: Array<[string, string]> = [
  [
    'Default list (tenant, newest first, page 1)',
    'SELECT * FROM properties WHERE tenant_id = 1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 25',
  ],
  ['Count for default list', 'SELECT COUNT(*) FROM properties WHERE tenant_id = 1 AND deleted_at IS NULL'],
  ['Status filter', 'SELECT * FROM properties WHERE tenant_id = 1 AND status_id IN (2,3) AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 25'],
  [
    'AGENT scope (assignee = self)',
    'SELECT * FROM properties WHERE tenant_id = 1 AND assignee_id = 4 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 25',
  ],
  [
    'Sale + price range, sort by price',
    "SELECT * FROM properties WHERE tenant_id = 1 AND listing_type = 'SALE' AND price_inr BETWEEN 5000000 AND 20000000 AND deleted_at IS NULL ORDER BY price_inr ASC, id ASC LIMIT 25",
  ],
  ['Locality filter', 'SELECT * FROM properties WHERE tenant_id = 1 AND locality_id IN (3,5) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25'],
  ['Type + BHK', 'SELECT * FROM properties WHERE tenant_id = 1 AND type_id = 1 AND bhk IN (2,3) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25'],
  [
    'Duplicate check / unique constraint',
    "SELECT id FROM properties WHERE tenant_id = 1 AND building_name = 'Lodha Park' AND unit_no = '1001' AND deleted_at IS NULL",
  ],
];

async function main() {
  for (const [label, sql] of CASES) {
    const rows = await sequelize.query<Record<string, unknown>>(`EXPLAIN ${sql}`, { type: QueryTypes.SELECT });
    const started = Date.now();
    await sequelize.query(sql, { type: QueryTypes.SELECT });
    const ms = Date.now() - started;
    console.log(`\n### ${label}  (${ms} ms)\n${sql}`);
    console.table(rows.map((r) => ({ type: r.type, key: r.key, key_len: r.key_len, rows: r.rows, filtered: r.filtered, Extra: r.Extra })));
  }
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
