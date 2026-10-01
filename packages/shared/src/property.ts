import { z } from 'zod';
import { csvArray, idParam, indianMobile, isoDateTime, paginationQuery } from './common';

export const LISTING_TYPES = ['SALE', 'RENT'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const FURNISHING = ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'] as const;
export type Furnishing = (typeof FURNISHING)[number];

/**
 * One schema per entity. The five form sections of the web app map onto these groups:
 * Basics · Location · Pricing & size · Owner · Amenities.
 */
const propertyFields = {
  // Basics
  title: z.string().trim().min(3, 'Title is too short').max(200),
  typeId: z.coerce.number().int().positive({ message: 'Choose a property type' }),
  listingType: z.enum(LISTING_TYPES),
  bhk: z.coerce.number().int().min(0).max(20),
  furnishing: z.enum(FURNISHING).default('UNFURNISHED'),
  statusId: z.coerce.number().int().positive().optional(),
  // Location
  buildingName: z.string().trim().min(1, 'Building name is required').max(150),
  unitNo: z.string().trim().min(1, 'Unit number is required').max(40),
  floor: z.coerce.number().int().min(-5).max(200).nullable().optional(),
  totalFloors: z.coerce.number().int().min(0).max(200).nullable().optional(),
  localityId: z.coerce.number().int().positive({ message: 'Choose a locality' }),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().max(500).nullable().optional(),
  // Pricing & size
  priceInr: z.coerce.number().int().positive('Price must be greater than 0').max(10_000_000_000),
  carpetAreaSqft: z.coerce.number().int().positive('Area must be greater than 0').max(1_000_000),
  // Owner
  ownerName: z.string().trim().min(2).max(120),
  ownerPhone: indianMobile,
  // Amenities
  amenityIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
  // Assignment (ADMIN / MANAGER only; AGENT is always self)
  assigneeId: z.coerce.number().int().positive().nullable().optional(),
};

const floorsRefine = (v: { floor?: number | null; totalFloors?: number | null }) => v.floor == null || v.totalFloors == null || v.floor <= v.totalFloors;
const floorsMsg = { message: 'Floor cannot exceed total floors', path: ['floor'] };

export const propertyCreateSchema = z.object(propertyFields).refine(floorsRefine, floorsMsg);
export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;

export const propertyUpdateSchema = z
  .object(propertyFields)
  .partial()
  .extend({ version: z.coerce.number().int().min(1, 'version is required for optimistic locking') })
  .refine(floorsRefine, floorsMsg);
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

export const PROPERTY_SORT_FIELDS = [
  'id',
  'title',
  'listingType',
  'bhk',
  'furnishing',
  'carpetAreaSqft',
  'priceInr',
  'pricePerSqft',
  'buildingName',
  'unitNo',
  'city',
  'ownerName',
  'status',
  'type',
  'locality',
  'assignee',
  'createdAt',
  'updatedAt',
  'lastActivityAt',
] as const;
export type PropertySortField = (typeof PROPERTY_SORT_FIELDS)[number];

export const propertyListQuerySchema = paginationQuery
  .extend({
    status: csvArray(z.coerce.number().int().positive()),
    type: csvArray(z.coerce.number().int().positive()),
    listingType: z.enum(LISTING_TYPES).optional(),
    bhk: csvArray(z.coerce.number().int().min(0).max(20)),
    locality: csvArray(z.coerce.number().int().positive()),
    assignee: csvArray(z.coerce.number().int().positive()),
    amenity: csvArray(z.coerce.number().int().positive()),
    priceMin: z.coerce.number().int().min(0).optional(),
    priceMax: z.coerce.number().int().min(0).optional(),
    areaMin: z.coerce.number().int().min(0).optional(),
    areaMax: z.coerce.number().int().min(0).optional(),
    createdFrom: isoDateTime.optional(),
    createdTo: isoDateTime.optional(),
    stale: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    q: z.string().trim().max(100).optional(),
    sortBy: z.enum(PROPERTY_SORT_FIELDS).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((v) => v.priceMin == null || v.priceMax == null || v.priceMin <= v.priceMax, {
    message: 'priceMin must be ≤ priceMax',
    path: ['priceMin'],
  })
  .refine((v) => v.areaMin == null || v.areaMax == null || v.areaMin <= v.areaMax, {
    message: 'areaMin must be ≤ areaMax',
    path: ['areaMin'],
  });
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;

export const BULK_ACTIONS = ['reassign', 'changeStatus', 'addAmenity'] as const;

export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reassign'),
    ids: z.array(idParam).min(1).max(500),
    assigneeId: idParam,
  }),
  z.object({
    action: z.literal('changeStatus'),
    ids: z.array(idParam).min(1).max(500),
    statusId: idParam,
  }),
  z.object({
    action: z.literal('addAmenity'),
    ids: z.array(idParam).min(1).max(500),
    amenityId: idParam,
  }),
]);
export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export const duplicateCheckQuerySchema = z.object({
  buildingName: z.string().trim().min(1).max(150),
  unitNo: z.string().trim().min(1).max(40),
  excludeId: z.coerce.number().int().positive().optional(),
});

export const noteCreateSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const chatSendSchema = z.object({
  propertyId: idParam,
  clientMsgId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'clientMsgId must be url-safe'),
  body: z.string().trim().min(1).max(4000),
});
export type ChatSendInput = z.infer<typeof chatSendSchema>;

export const chatHistoryQuerySchema = z.object({
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
