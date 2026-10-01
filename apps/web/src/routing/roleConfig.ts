
import type { Role } from '../app/store';

export type NavItem = [string, string];

export const can = (
  role: Role | undefined,
  roles: Role[]
) => !!role && roles.includes(role);

export const navFor = (role: Role): NavItem[] => {
  if (role === 'SUPER_ADMIN') {
    return [
      ['Tenants', '/platform/tenants'],
      ['Security', '/platform/security'],
    ];
  }

 if (role === 'AGENT') {
  return [
    ['My Properties', '/my-properties'],
    ['Calendar', '/calendar'],
  ];
}

  return [
    ['Dashboard', '/dashboard'],
    ['Properties', '/properties'],
    ['Calendar', '/calendar'],
    ['Users', '/admin/users'],
    ['Master Data', '/admin/master-data'],
  ];
};
