/**
 * Deterministic seed fixture. auth-server and crm-api own different databases, so both
 * seeders read the same ids from here to stay consistent (crm-api keeps a read-only
 * mirror of users for names, assignment and leaderboards).
 */
export const SEED_TENANTS = [
  { id: 1, name: 'Skyline Realty', slug: 'skyline' },
  { id: 2, name: 'Harbour Homes', slug: 'harbour' },
] as const;

export const SEED_USERS = [
  { id: 1, tenantId: null, role: 'SUPER_ADMIN', name: 'Platform Owner', email: 'super@propflow.dev' },
  { id: 2, tenantId: 1, role: 'ADMIN', name: 'Aarav Mehta', email: 'admin@skyline.dev' },
  { id: 3, tenantId: 1, role: 'MANAGER', name: 'Neha Kapoor', email: 'manager@skyline.dev' },
  { id: 4, tenantId: 1, role: 'AGENT', name: 'Riya Sharma', email: 'riya@skyline.dev' },
  { id: 5, tenantId: 1, role: 'AGENT', name: 'Kabir Singh', email: 'kabir@skyline.dev' },
  { id: 6, tenantId: 2, role: 'ADMIN', name: 'Ishaan Rao', email: 'admin@harbour.dev' },
  { id: 7, tenantId: 2, role: 'MANAGER', name: 'Meera Iyer', email: 'manager@harbour.dev' },
  { id: 8, tenantId: 2, role: 'AGENT', name: 'Arjun Nair', email: 'arjun@harbour.dev' },
  { id: 9, tenantId: 2, role: 'AGENT', name: 'Sara Khan', email: 'sara@harbour.dev' },
] as const;

export const DEFAULT_STATUS_PIPELINE = [
  { key: 'draft', name: 'Draft', stage: 'OPEN' },
  { key: 'listed', name: 'Listed', stage: 'OPEN' },
  { key: 'site_visit', name: 'Site Visit', stage: 'OPEN' },
  { key: 'negotiation', name: 'Negotiation', stage: 'OPEN' },
  { key: 'closed', name: 'Closed', stage: 'WON' },
  { key: 'withdrawn', name: 'Withdrawn', stage: 'LOST' },
] as const;

export const DEFAULT_PROPERTY_TYPES = ['Apartment', 'Villa', 'Plot', 'Commercial'] as const;

export const DEFAULT_AMENITIES = [
  'Lift',
  'Parking',
  'Power Backup',
  'Gym',
  'Swimming Pool',
  'Clubhouse',
  'Security',
  'Garden',
  'Children Play Area',
  'Gated Community',
] as const;
