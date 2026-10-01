import type { PropertyListQuery } from '@propflow/shared';
import { literal, Op, OrderItem, WhereOptions } from 'sequelize';
import { escapeLike } from '../lib/format';
import { Actor, propertyScope } from '../middleware/auth';
import type { MasterMaps } from './masterData.service';

/**
 * Builds the WHERE for GET /properties and GET /properties/export from the shared Zod
 * query. Tenant (and agent) scope always comes from propertyScope(actor) — the query
 * string can narrow the scope, never widen it.
 */
export function buildPropertyWhere(actor: Actor, q: Partial<PropertyListQuery>, maps: MasterMaps): WhereOptions {
  const and: WhereOptions[] = [propertyScope(actor)];

  if (q.status?.length) and.push({ statusId: { [Op.in]: q.status } });
  if (q.type?.length) and.push({ typeId: { [Op.in]: q.type } });
  if (q.listingType) and.push({ listingType: q.listingType });
  if (q.bhk?.length) and.push({ bhk: { [Op.in]: q.bhk } });
  if (q.locality?.length) and.push({ localityId: { [Op.in]: q.locality } });
  if (q.assignee?.length && actor.role !== 'AGENT') and.push({ assigneeId: { [Op.in]: q.assignee } });
  if (q.priceMin != null) and.push({ priceInr: { [Op.gte]: q.priceMin } });
  if (q.priceMax != null) and.push({ priceInr: { [Op.lte]: q.priceMax } });
  if (q.areaMin != null) and.push({ carpetAreaSqft: { [Op.gte]: q.areaMin } });
  if (q.areaMax != null) and.push({ carpetAreaSqft: { [Op.lte]: q.areaMax } });
  if (q.createdFrom) and.push({ createdAt: { [Op.gte]: new Date(q.createdFrom) } });
  if (q.createdTo) and.push({ createdAt: { [Op.lte]: new Date(q.createdTo) } });
  if (q.stale != null) and.push({ isStale: q.stale });

  if (q.amenity?.length) {
    // Listing must have ALL selected amenities.
    const ids = q.amenity.map(Number).filter(Number.isInteger).join(',');
    and.push({
      id: {
        [Op.in]: literal(
          `(SELECT pa.property_id FROM property_amenities pa WHERE pa.amenity_id IN (${ids}) GROUP BY pa.property_id HAVING COUNT(DISTINCT pa.amenity_id) = ${q.amenity.length})`,
        ),
      },
    });
  }

  if (q.q && q.q.trim().length > 0) {
    const term = q.q.trim();
    const like = `%${escapeLike(term)}%`;
    const or: WhereOptions[] = [
      { title: { [Op.like]: like } },
      { buildingName: { [Op.like]: like } },
      { unitNo: { [Op.like]: like } },
      { ownerName: { [Op.like]: like } },
    ];
    const digits = term.replace(/\D/g, '');
    if (digits.length >= 3 && digits.length === term.replace(/[\s+-]/g, '').length) {
      or.push({ ownerPhone: { [Op.like]: `%${digits}%` } });
    }
    const lower = term.toLowerCase();
    const localityIds = [...maps.localities.values()].filter((l) => l.name.toLowerCase().includes(lower)).map((l) => l.id);
    if (localityIds.length) or.push({ localityId: { [Op.in]: localityIds } });
    and.push({ [Op.or]: or });
  }

  return { [Op.and]: and };
}

/** Server-side sort on any column (names sort by their master-data / user name). */
export function buildOrder(sortBy: PropertyListQuery['sortBy'] = 'createdAt', sortOrder: 'asc' | 'desc' = 'desc'): OrderItem[] {
  const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';
  const col = (c: string): OrderItem => [c, dir];
  const lit = (sql: string): OrderItem => [literal(sql), dir];
  const byField: Record<string, OrderItem> = {
    id: col('id'),
    title: col('title'),
    listingType: col('listingType'),
    bhk: col('bhk'),
    furnishing: col('furnishing'),
    carpetAreaSqft: col('carpetAreaSqft'),
    priceInr: col('priceInr'),
    pricePerSqft: lit('(`Property`.`price_inr` / NULLIF(`Property`.`carpet_area_sqft`, 0))'),
    buildingName: col('buildingName'),
    unitNo: col('unitNo'),
    city: col('city'),
    ownerName: col('ownerName'),
    status: lit('(SELECT s.sort_order FROM property_statuses s WHERE s.id = `Property`.`status_id`)'),
    type: lit('(SELECT t.name FROM property_types t WHERE t.id = `Property`.`type_id`)'),
    locality: lit('(SELECT l.name FROM localities l WHERE l.id = `Property`.`locality_id`)'),
    assignee: lit('(SELECT u.name FROM users u WHERE u.id = `Property`.`assignee_id`)'),
    createdAt: col('createdAt'),
    updatedAt: col('updatedAt'),
    lastActivityAt: col('lastActivityAt'),
  };
  return [byField[sortBy] ?? col('createdAt'), ['id', dir]];
}
