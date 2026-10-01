import { z } from 'zod';
import { idParam } from './common';

export const MASTER_DATA_KINDS = ['statuses', 'types', 'localities', 'amenities'] as const;
export type MasterDataKind = (typeof MASTER_DATA_KINDS)[number];

/** OPEN = still in the pipeline, WON = Closed, LOST = Withdrawn. WON/LOST are terminal. */
export const STATUS_STAGES = ['OPEN', 'WON', 'LOST'] as const;
export type StatusStage = (typeof STATUS_STAGES)[number];

export const masterDataKindParam = z.enum(MASTER_DATA_KINDS);

const base = {
  name: z.string().trim().min(1).max(80),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
};

export const masterDataCreateSchemas = {
  statuses: z.object({ ...base, stage: z.enum(STATUS_STAGES).default('OPEN') }),
  types: z.object(base),
  localities: z.object({ ...base, city: z.string().trim().min(2).max(80) }),
  amenities: z.object(base),
} as const;

export const masterDataUpdateSchemas = {
  statuses: masterDataCreateSchemas.statuses.partial(),
  types: masterDataCreateSchemas.types.partial(),
  localities: masterDataCreateSchemas.localities.partial(),
  amenities: masterDataCreateSchemas.amenities.partial(),
} as const;

export const reorderSchema = z.object({
  ids: z.array(idParam).min(1).max(500),
});

export const dashboardQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    tz: z.string().max(64).default('Asia/Kolkata'),
  })
  .refine((v) => v.from <= v.to, { message: 'from must be ≤ to', path: ['from'] });
