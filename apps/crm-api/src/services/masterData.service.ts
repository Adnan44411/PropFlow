import { DEFAULT_AMENITIES, DEFAULT_PROPERTY_TYPES, DEFAULT_STATUS_PIPELINE, MasterDataKind, MASTER_DATA_KINDS, StatusStage } from '@propflow/shared';
import { Op, UniqueConstraintError } from 'sequelize';
import { config } from '../config';
import { sequelize } from '../lib/db';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import { Amenity, Locality, Property, PropertyAmenity, PropertyStatus, PropertyType } from '../models';

export interface MasterItem {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  stage?: StatusStage;
  isTerminal?: boolean;
  key?: string | null;
  city?: string;
}

const MODELS = {
  statuses: PropertyStatus,
  types: PropertyType,
  localities: Locality,
  amenities: Amenity,
} as const;

// Each model has the same base shape; this keeps the generic CRUD code readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMasterModel = any;
const model = (kind: MasterDataKind): AnyMasterModel => MODELS[kind];

const cacheKey = (tenantId: number, kind: MasterDataKind) => `md:${tenantId}:${kind}`;

function toItem(kind: MasterDataKind, row: Record<string, unknown>): MasterItem {
  const item: MasterItem = {
    id: Number(row.id),
    name: String(row.name),
    sortOrder: Number(row.sortOrder),
    isActive: Boolean(row.isActive),
  };
  if (kind === 'statuses') {
    item.stage = row.stage as StatusStage;
    item.isTerminal = row.stage !== 'OPEN';
    item.key = (row.key as string | null) ?? null;
  }
  if (kind === 'localities') item.city = String(row.city);
  return item;
}

/** Read-through cache `md:{tenantId}:{kind}`. */
export async function getMasterData(tenantId: number, kind: MasterDataKind): Promise<MasterItem[]> {
  const key = cacheKey(tenantId, kind);
  const cached = await redis.get(key).catch(() => null);
  if (cached) return JSON.parse(cached) as MasterItem[];
  const rows = (await model(kind).findAll({
    where: { tenantId },
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
    raw: true,
  })) as Record<string, unknown>[];
  const items = rows.map((r) => toItem(kind, r));
  await redis.set(key, JSON.stringify(items), 'EX', config.MASTER_DATA_CACHE_SECONDS).catch(() => undefined);
  return items;
}

export interface MasterMaps {
  statuses: Map<number, MasterItem>;
  types: Map<number, MasterItem>;
  localities: Map<number, MasterItem>;
  amenities: Map<number, MasterItem>;
}

export async function getMasterMaps(tenantId: number): Promise<MasterMaps> {
  const [statuses, types, localities, amenities] = await Promise.all(MASTER_DATA_KINDS.map((k) => getMasterData(tenantId, k)));
  const toMap = (items: MasterItem[]) => new Map(items.map((i) => [i.id, i]));
  return { statuses: toMap(statuses), types: toMap(types), localities: toMap(localities), amenities: toMap(amenities) };
}

/** Any master-data write clears every md:{tenant}:* key (4 known keys, no SCAN needed). */
export async function invalidateMasterData(tenantId: number): Promise<void> {
  await redis.del(...MASTER_DATA_KINDS.map((k) => cacheKey(tenantId, k)));
}

type Notifier = (tenantId: number, kind: MasterDataKind) => void;
let notify: Notifier = () => undefined;
/** Socket layer registers here to push `masterdata:updated` so open tables refetch (H10). */
export const onMasterDataChanged = (fn: Notifier) => {
  notify = fn;
};

async function afterWrite(tenantId: number, kind: MasterDataKind) {
  await invalidateMasterData(tenantId);
  notify(tenantId, kind);
}

export async function listMasterData(tenantId: number, kind: MasterDataKind, includeInactive: boolean) {
  const items = await getMasterData(tenantId, kind);
  return includeInactive ? items : items.filter((i) => i.isActive);
}

export async function createMasterData(tenantId: number, kind: MasterDataKind, input: Record<string, unknown>) {
  const M = model(kind);
  const sortOrder = input.sortOrder ?? ((await M.max('sortOrder', { where: { tenantId } })) ?? 0) + 10;
  try {
    const row = await M.create({ ...input, tenantId, sortOrder });
    await afterWrite(tenantId, kind);
    return toItem(kind, row.get({ plain: true }));
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw Errors.conflict('CONFLICT', `"${input.name}" already exists`, { fields: { name: 'Name already exists' } });
    throw err;
  }
}

async function inUseCount(tenantId: number, kind: MasterDataKind, id: number): Promise<number> {
  switch (kind) {
    case 'statuses':
      return Property.count({ where: { tenantId, statusId: id }, paranoid: false });
    case 'types':
      return Property.count({ where: { tenantId, typeId: id }, paranoid: false });
    case 'localities':
      return Property.count({ where: { tenantId, localityId: id }, paranoid: false });
    case 'amenities':
      return PropertyAmenity.count({ where: { amenityId: id } });
    default:
      return 0;
  }
}

export async function updateMasterData(tenantId: number, kind: MasterDataKind, id: number, input: Record<string, unknown>) {
  const row = await model(kind).findOne({ where: { id, tenantId } });
  if (!row) throw Errors.notFound('Item');
  if (kind === 'statuses' && input.isActive === false) {
    const activeOpen = await PropertyStatus.count({ where: { tenantId, isActive: true, stage: 'OPEN', id: { [Op.ne]: id } } });
    if (activeOpen === 0) throw Errors.rule('BUSINESS_RULE', 'At least one active open status is required');
  }
  try {
    await row.update(input);
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw Errors.conflict('CONFLICT', `"${input.name}" already exists`, { fields: { name: 'Name already exists' } });
    throw err;
  }
  await afterWrite(tenantId, kind);
  return toItem(kind, row.get({ plain: true }));
}

/** Items in use cannot be deleted (422 IN_USE) — the client offers "Deactivate" instead. */
export async function deleteMasterData(tenantId: number, kind: MasterDataKind, id: number) {
  const row = await model(kind).findOne({ where: { id, tenantId } });
  if (!row) throw Errors.notFound('Item');
  const used = await inUseCount(tenantId, kind, id);
  if (used > 0) {
    throw Errors.rule('IN_USE', `"${row.name}" is used by ${used} listing${used === 1 ? '' : 's'}; deactivate it instead`, {
      usedBy: used,
      suggestion: 'deactivate',
    });
  }
  await row.destroy();
  await afterWrite(tenantId, kind);
}

/** Drag-to-reorder: ids in the new order → sort_order 10, 20, 30… in one transaction. */
export async function reorderMasterData(tenantId: number, kind: MasterDataKind, ids: number[]) {
  const M = model(kind);
  await sequelize.transaction(async (transaction) => {
    const count = await M.count({ where: { tenantId, id: ids }, transaction });
    if (count !== new Set(ids).size) throw Errors.validation({ fields: { ids: 'Unknown id in list' } });
    for (let i = 0; i < ids.length; i++) {
      await M.update({ sortOrder: (i + 1) * 10 }, { where: { tenantId, id: ids[i] }, transaction });
    }
  });
  await afterWrite(tenantId, kind);
  return listMasterData(tenantId, kind, true);
}

const tenantsWithDefaults = new Set<number>();

/**
 * Every tenant needs the status pipeline + property types to be usable. Called on tenant.created
 * and lazily on first request. Idempotent (only inserts when the tenant has no statuses).
 */
export async function ensureTenantDefaults(tenantId: number): Promise<void> {
  if (tenantsWithDefaults.has(tenantId)) return;
  const lockKey = `lock:defaults:${tenantId}`;
  const got = await redis.set(lockKey, '1', 'EX', 30, 'NX');
  try {
    if ((await PropertyStatus.count({ where: { tenantId } })) === 0 && got) {
      await sequelize.transaction(async (transaction) => {
        await PropertyStatus.bulkCreate(
          DEFAULT_STATUS_PIPELINE.map((s, i) => ({ tenantId, key: s.key, name: s.name, stage: s.stage, sortOrder: (i + 1) * 10 })),
          { transaction },
        );
        await PropertyType.bulkCreate(
          DEFAULT_PROPERTY_TYPES.map((name, i) => ({ tenantId, name, sortOrder: (i + 1) * 10 })),
          { transaction },
        );
        await Amenity.bulkCreate(
          DEFAULT_AMENITIES.map((name, i) => ({ tenantId, name, sortOrder: (i + 1) * 10 })),
          { transaction },
        );
      });
      await invalidateMasterData(tenantId);
      logger.info('created default master data for tenant', { tenantId });
    }
    if ((await PropertyStatus.count({ where: { tenantId } })) > 0) tenantsWithDefaults.add(tenantId);
  } finally {
    if (got) await redis.del(lockKey);
  }
}

export function defaultStatus(maps: MasterMaps): MasterItem | undefined {
  return [...maps.statuses.values()].filter((s) => s.isActive && s.stage === 'OPEN').sort((a, b) => a.sortOrder - b.sortOrder)[0];
}
