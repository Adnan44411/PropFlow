export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'AGENT'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that live inside a tenant (SUPER_ADMIN is platform-level, tid = null). */
export const TENANT_ROLES = ['ADMIN', 'MANAGER', 'AGENT'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: 'Platform console: tenants, counts, signing keys. Never sees tenant data.',
  ADMIN: 'Everything inside the tenant: users, invites, master data, all properties, export, dashboard.',
  MANAGER: 'All properties of the tenant, reassign, bulk actions, export, dashboard, team calendar.',
  AGENT: 'Only properties assigned to them: view, edit, notes, chat, site visits, own calendar.',
};
