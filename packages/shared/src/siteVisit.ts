import { z } from 'zod';
import { idParam, isoDateTime } from './common';

export const VISIT_OUTCOMES = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'INTERESTED', 'NOT_INTERESTED'] as const;

export const siteVisitCreateSchema = z.object({
  propertyId: idParam,
  /** Always UTC on the wire (the client converts from the user's zone). */
  visitAt: isoDateTime,
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  visitorName: z.string().trim().min(2).max(120).optional(),
  visitorPhone: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** ADMIN / MANAGER may schedule for another agent; AGENT is always self. */
  agentId: idParam.optional(),
});
export type SiteVisitCreateInput = z.infer<typeof siteVisitCreateSchema>;

export const siteVisitUpdateSchema = z
  .object({
    visitAt: isoDateTime.optional(),
    durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
    outcome: z.enum(VISIT_OUTCOMES).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    agentId: idParam.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type SiteVisitUpdateInput = z.infer<typeof siteVisitUpdateSchema>;

export const siteVisitListQuerySchema = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  agentId: idParam.optional(),
  propertyId: idParam.optional(),
});
