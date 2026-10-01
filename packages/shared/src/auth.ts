import { z } from 'zod';
import { email, password, slug } from './common';
import { TENANT_ROLES } from './roles';

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerTenantSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  slug,
  adminName: z.string().trim().min(2).max(120),
  adminEmail: email,
  password,
});
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

/** SUPER_ADMIN creates a tenant + its first ADMIN (who receives an invite link). */
export const createTenantSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  slug,
  adminName: z.string().trim().min(2).max(120),
  adminEmail: email,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const inviteSchema = z.object({
  email,
  name: z.string().trim().min(2).max(120),
  role: z.enum(TENANT_ROLES),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
  name: z.string().trim().min(2).max(120).optional(),
  password,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const updateUserSchema = z
  .object({
    role: z.enum(TENANT_ROLES).optional(),
    isActive: z.boolean().optional(),
    name: z.string().trim().min(2).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
