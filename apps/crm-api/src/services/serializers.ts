import { maskPhone } from '../lib/format';
import { Actor, isStaff } from '../middleware/auth';
import type { MasterMaps } from './masterData.service';

export interface PropertyRow {
  id: number;
  tenantId: number;
  title: string;
  typeId: number;
  statusId: number;
  listingType: 'SALE' | 'RENT';
  bhk: number;
  furnishing: string;
  carpetAreaSqft: number;
  priceInr: number | string;
  listedPriceInr: number | string;
  buildingName: string;
  unitNo: string;
  floor: number | null;
  totalFloors: number | null;
  localityId: number;
  city: string;
  address: string | null;
  ownerName: string;
  ownerPhone: string;
  assigneeId: number | null;
  createdBy: number | null;
  isStale: boolean | number;
  lastActivityAt: Date | string;
  closedAt: Date | string | null;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface SerializeCtx {
  actor: Actor;
  maps: MasterMaps;
  users: Map<number, string>;
}

/** Owner phone is visible to ADMIN/MANAGER and to the assignee; everyone else gets it masked. */
export const canSeeOwnerPhone = (actor: Actor, row: { assigneeId: number | null }) =>
  isStaff(actor) || (row.assigneeId != null && row.assigneeId === actor.userId);

const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());

export function serializeProperty(row: PropertyRow, ctx: SerializeCtx, extra?: { amenityIds?: number[] }) {
  const price = Number(row.priceInr);
  const listed = Number(row.listedPriceInr);
  const status = ctx.maps.statuses.get(row.statusId);
  const type = ctx.maps.types.get(row.typeId);
  const locality = ctx.maps.localities.get(row.localityId);
  const showPhone = canSeeOwnerPhone(ctx.actor, row);
  const out: Record<string, unknown> = {
    id: Number(row.id),
    title: row.title,
    listingType: row.listingType,
    bhk: row.bhk,
    furnishing: row.furnishing,
    carpetAreaSqft: row.carpetAreaSqft,
    priceInr: price,
    pricePerSqft: row.carpetAreaSqft > 0 ? Math.round(price / row.carpetAreaSqft) : null,
    listedPriceInr: listed,
    priceChangePct: listed > 0 ? Math.round(((price - listed) / listed) * 10000) / 100 : 0,
    buildingName: row.buildingName,
    unitNo: row.unitNo,
    floor: row.floor,
    totalFloors: row.totalFloors,
    city: row.city,
    address: row.address,
    ownerName: row.ownerName,
    ownerPhone: showPhone ? row.ownerPhone : maskPhone(row.ownerPhone),
    ownerPhoneMasked: !showPhone,
    type: type ? { id: type.id, name: type.name } : { id: row.typeId, name: null },
    status: status
      ? { id: status.id, name: status.name, stage: status.stage, isTerminal: status.isTerminal, sortOrder: status.sortOrder }
      : { id: row.statusId, name: null },
    locality: locality ? { id: locality.id, name: locality.name, city: locality.city } : { id: row.localityId, name: null },
    assignee: row.assigneeId ? { id: row.assigneeId, name: ctx.users.get(row.assigneeId) ?? null } : null,
    isStale: Boolean(row.isStale),
    lastActivityAt: iso(row.lastActivityAt),
    closedAt: iso(row.closedAt),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  if (extra?.amenityIds) {
    out.amenities = extra.amenityIds
      .map((id) => ctx.maps.amenities.get(id))
      .filter(Boolean)
      .map((a) => ({ id: a!.id, name: a!.name }));
    out.amenityIds = extra.amenityIds;
  }
  return out;
}
