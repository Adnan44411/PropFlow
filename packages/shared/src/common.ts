import { z } from 'zod';

/** Indian mobile: optional +91 / 0 prefix, 10 digits starting 6-9. Normalised to 10 digits. */
export const indianMobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(?:\+91|91|0)?[6-9]\d{9}$/.test(v), { message: 'Enter a valid 10-digit Indian mobile number' })
  .transform((v) => v.slice(-10));

export const idParam = z.coerce.number().int().positive();

export const isoDateTime = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time, e.g. 2026-10-01T04:30:00Z' });

/** Accepts `a,b,c`, `['a','b']` or a single value, returns an array (used for query-string filters). */
export function csvArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr
      .flatMap((x) => String(x).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  }, z.array(item).max(200).optional());
}

export const email = z.string().trim().toLowerCase().email().max(190);

export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a digit');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
