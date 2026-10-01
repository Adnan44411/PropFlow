import { QueryTypes } from 'sequelize';
import { sequelize } from '../lib/db';

/** SUPER_ADMIN: counts only. No property details, owner phones or chats are ever returned. */
export async function tenantStats() {
  const rows = await sequelize.query<{ tenantId: number; properties: number; activeProperties: number; closedProperties: number }>(
    `SELECT p.tenant_id AS tenantId,
            COUNT(*) AS properties,
            SUM(s.stage = 'OPEN') AS activeProperties,
            SUM(s.stage = 'WON') AS closedProperties
       FROM properties p JOIN property_statuses s ON s.id = p.status_id
      WHERE p.deleted_at IS NULL
      GROUP BY p.tenant_id`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((r) => ({
    tenantId: Number(r.tenantId),
    properties: Number(r.properties),
    activeProperties: Number(r.activeProperties),
    closedProperties: Number(r.closedProperties),
  }));
}
