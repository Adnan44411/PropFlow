/**
 * npm run seed (crm-api part). DESTRUCTIVE: truncates crm_db tables, then creates
 *  - tenant/user mirrors matching auth-server's seed (same ids, from @propflow/shared)
 *  - master data for both tenants (status pipeline, 4 types, 20 localities, 10 amenities)
 *  - 10,000 properties for tenant A across 12 months, 300 for tenant B
 *  - site visits, notes, chat messages and activity on 60+ properties
 * Deterministic (seeded PRNG) so EXPLAIN output and demos are reproducible.
 */
import { DEFAULT_AMENITIES, DEFAULT_PROPERTY_TYPES, DEFAULT_STATUS_PIPELINE, SEED_TENANTS, SEED_USERS } from '@propflow/shared';
import { sequelize } from '../src/lib/db';
import { redis } from '../src/lib/redis';

let seed = 42;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const weighted = <T>(pairs: Array<[T, number]>): T => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
};
const round = (n: number, to: number) => Math.round(n / to) * to;

const LOCALITIES_A: Array<[string, string, number]> = [
  // name, city, sale ₹/sqft
  ['Andheri West', 'Mumbai', 26000],
  ['Bandra West', 'Mumbai', 48000],
  ['Powai', 'Mumbai', 24000],
  ['Goregaon East', 'Mumbai', 19000],
  ['Malad West', 'Mumbai', 18000],
  ['Borivali West', 'Mumbai', 17500],
  ['Thane West', 'Thane', 14000],
  ['Chembur', 'Mumbai', 22000],
  ['Ghatkopar East', 'Mumbai', 21000],
  ['Juhu', 'Mumbai', 45000],
  ['Worli', 'Mumbai', 42000],
  ['Lower Parel', 'Mumbai', 40000],
  ['Kandivali East', 'Mumbai', 16500],
  ['Mulund West', 'Mumbai', 16000],
  ['Vashi', 'Navi Mumbai', 13500],
  ['Kharghar', 'Navi Mumbai', 9500],
  ['Hinjewadi', 'Pune', 7500],
  ['Baner', 'Pune', 10500],
  ['Wakad', 'Pune', 8000],
  ['Kothrud', 'Pune', 11500],
];
const LOCALITIES_B: Array<[string, string, number]> = [
  ['Whitefield', 'Bengaluru', 8500],
  ['Koramangala', 'Bengaluru', 16000],
  ['Indiranagar', 'Bengaluru', 18000],
  ['HSR Layout', 'Bengaluru', 12500],
  ['Electronic City', 'Bengaluru', 6000],
  ['Hebbal', 'Bengaluru', 11000],
  ['Jayanagar', 'Bengaluru', 15000],
  ['Sarjapur Road', 'Bengaluru', 8000],
];
const BUILDING_PREFIX = [
  'Lodha',
  'Hiranandani',
  'Oberoi',
  'Godrej',
  'Kalpataru',
  'Runwal',
  'Rustomjee',
  'Raheja',
  'Prestige',
  'Sobha',
  'Brigade',
  'Mahindra',
  'Tata',
  'Shapoorji',
  'Kolte Patil',
  'Panchshil',
  'Sunteck',
  'Wadhwa',
  'Piramal',
  'Ajmera',
];
const BUILDING_SUFFIX = [
  'Park',
  'Gardens',
  'Heights',
  'Residency',
  'Towers',
  'Enclave',
  'Vista',
  'Greens',
  'Crest',
  'Springs',
  'Serenity',
  'Horizon',
  'Palms',
  'Meadows',
  'Signature',
];
const FIRST = [
  'Rahul',
  'Priya',
  'Amit',
  'Sneha',
  'Vikram',
  'Anjali',
  'Rohan',
  'Pooja',
  'Suresh',
  'Kavita',
  'Arjun',
  'Divya',
  'Manish',
  'Neha',
  'Sanjay',
  'Ritu',
  'Karan',
  'Meera',
  'Deepak',
  'Asha',
  'Farhan',
  'Zoya',
  'Harpreet',
  'Lakshmi',
  'Venkat',
];
const LAST = [
  'Shah',
  'Patel',
  'Mehta',
  'Iyer',
  'Nair',
  'Gupta',
  'Deshmukh',
  'Kulkarni',
  'Joshi',
  'Reddy',
  'Khan',
  'Singh',
  'Rao',
  'Menon',
  'Bhatt',
  'Chopra',
  'Pillai',
  'Sawant',
  'Agarwal',
  'Das',
];
const NOTES = [
  'Owner open to negotiation on price, prefers quick closure.',
  'Society NOC pending — follow up next week.',
  'Keys with watchman; call owner 30 min before visit.',
  'Buyer family visited, liked the view, asked about parking.',
  'Owner wants token amount of at least 5%.',
  'Needs minor paint work; owner will fix before handover.',
];
const CHAT = [
  'Client wants to visit this Saturday morning, is the owner available?',
  'Owner confirmed, 11 AM works.',
  'Can we push the price discussion to after the visit?',
  'Sure, I will share the floor plan with them tonight.',
  'They are asking if the society allows pets.',
  'Yes, pets are allowed. Sharing the society rules PDF.',
];

type Row = Record<string, unknown>;

async function bulk(table: string, rows: Row[], chunk = 1000) {
  for (let i = 0; i < rows.length; i += chunk) await sequelize.getQueryInterface().bulkInsert(table, rows.slice(i, i + chunk));
}

async function main() {
  const qi = sequelize.getQueryInterface();
  const now = new Date();
  console.log('truncating crm tables…');
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'chat_messages',
    'site_visits',
    'property_activity',
    'property_notes',
    'property_amenities',
    'properties',
    'amenities',
    'localities',
    'property_types',
    'property_statuses',
    'users',
    'tenants',
  ]) {
    await sequelize.query(`TRUNCATE TABLE \`${t}\``);
  }
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

  await qi.bulkInsert(
    'tenants',
    SEED_TENANTS.map((t) => ({ id: t.id, name: t.name, slug: t.slug, created_at: now, updated_at: now })),
  );
  await qi.bulkInsert(
    'users',
    SEED_USERS.map((u) => ({ id: u.id, tenant_id: u.tenantId, name: u.name, email: u.email, role: u.role, is_active: true, created_at: now, updated_at: now })),
  );

  // ── master data ──
  const md: Record<
    number,
    {
      statuses: Record<string, number>;
      stageOf: Record<number, string>;
      types: number[];
      typeName: Record<number, string>;
      localities: Array<{ id: number; name: string; city: string; rate: number }>;
      amenities: number[];
    }
  > = {};
  let statusId = 1,
    typeId = 1,
    localityId = 1,
    amenityId = 1;
  for (const t of SEED_TENANTS) {
    const entry = {
      statuses: {} as Record<string, number>,
      stageOf: {} as Record<number, string>,
      types: [] as number[],
      typeName: {} as Record<number, string>,
      localities: [] as Array<{ id: number; name: string; city: string; rate: number }>,
      amenities: [] as number[],
    };
    await qi.bulkInsert(
      'property_statuses',
      DEFAULT_STATUS_PIPELINE.map((s, i) => {
        entry.statuses[s.key] = statusId;
        entry.stageOf[statusId] = s.stage;
        return {
          id: statusId++,
          tenant_id: t.id,
          key: s.key,
          name: s.name,
          stage: s.stage,
          sort_order: (i + 1) * 10,
          is_active: true,
          created_at: now,
          updated_at: now,
        };
      }),
    );
    await qi.bulkInsert(
      'property_types',
      DEFAULT_PROPERTY_TYPES.map((name, i) => {
        entry.types.push(typeId);
        entry.typeName[typeId] = name;
        return { id: typeId++, tenant_id: t.id, name, sort_order: (i + 1) * 10, is_active: true, created_at: now, updated_at: now };
      }),
    );
    const locs = t.id === 1 ? LOCALITIES_A : LOCALITIES_B;
    await qi.bulkInsert(
      'localities',
      locs.map(([name, city, rate], i) => {
        entry.localities.push({ id: localityId, name, city, rate });
        return { id: localityId++, tenant_id: t.id, name, city, sort_order: (i + 1) * 10, is_active: true, created_at: now, updated_at: now };
      }),
    );
    await qi.bulkInsert(
      'amenities',
      DEFAULT_AMENITIES.map((name, i) => {
        entry.amenities.push(amenityId);
        return { id: amenityId++, tenant_id: t.id, name, sort_order: (i + 1) * 10, is_active: true, created_at: now, updated_at: now };
      }),
    );
    md[t.id] = entry;
  }

  // ── properties ──
  const properties: Row[] = [];
  const amenityRows: Row[] = [];
  const activityRows: Row[] = [];
  let pid = 1;
  const DAY = 86_400_000;
  for (const [tenantId, count] of [
    [1, 10_000],
    [2, 300],
  ] as const) {
    const m = md[tenantId];
    const agents = SEED_USERS.filter((u) => u.tenantId === tenantId && u.role === 'AGENT').map((u) => u.id);
    const buildings = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const loc = pick(m.localities);
      const typeName = weighted<string>([
        ['Apartment', 70],
        ['Villa', 10],
        ['Plot', 8],
        ['Commercial', 12],
      ]);
      const type = m.types.find((id) => m.typeName[id] === typeName)!;
      const listingType =
        typeName === 'Plot'
          ? 'SALE'
          : weighted<'SALE' | 'RENT'>([
              ['SALE', 68],
              ['RENT', 32],
            ]);
      const bhk =
        typeName === 'Apartment'
          ? weighted([
              [1, 25],
              [2, 40],
              [3, 25],
              [4, 10],
            ])
          : typeName === 'Villa'
            ? int(3, 5)
            : 0;
      const area =
        typeName === 'Plot'
          ? round(int(1200, 6000), 50)
          : typeName === 'Commercial'
            ? round(int(300, 4000), 25)
            : typeName === 'Villa'
              ? round(int(1800, 4500), 25)
              : round([0, int(350, 550), int(550, 850), int(850, 1300), int(1300, 2200)][bhk] ?? 600, 5);
      const rate = loc.rate * (typeName === 'Plot' ? 0.6 : typeName === 'Commercial' ? 1.2 : typeName === 'Villa' ? 1.1 : 1) * (0.85 + rand() * 0.3);
      let price: number;
      // Sale ₹15 L – ₹5 Cr; rent ≈ 3.6 % gross yield → ₹10 k – ₹2 L / month.
      if (listingType === 'SALE') price = Math.min(Math.max(round(area * rate, 50_000), 1_500_000), 50_000_000);
      else price = Math.min(Math.max(round(area * (rate / 330), 500), 10_000), 200_000);

      const bName = `${pick(BUILDING_PREFIX)} ${pick(BUILDING_SUFFIX)}${rand() < 0.4 ? ` ${String.fromCharCode(65 + int(0, 5))} Wing` : ''}`;
      const n = (buildings.get(bName) ?? 0) + 1;
      buildings.set(bName, n);
      const totalFloors = typeName === 'Villa' || typeName === 'Plot' ? (typeName === 'Villa' ? 3 : null) : int(7, 45);
      const floor = totalFloors && typeName !== 'Villa' ? int(1, totalFloors) : typeName === 'Villa' ? 0 : null;
      const unitNo = typeName === 'Plot' ? `P-${n}` : typeName === 'Villa' ? `V-${n}` : `${floor ?? 0}${String(n).padStart(3, '0')}`;

      const createdAt = new Date(now.getTime() - int(0, 364) * DAY - int(0, DAY - 1));
      const status = weighted<string>([
        ['draft', 6],
        ['listed', 42],
        ['site_visit', 16],
        ['negotiation', 10],
        ['closed', 18],
        ['withdrawn', 8],
      ]);
      const sId = m.statuses[status];
      const closedAt = status === 'closed' ? new Date(Math.min(createdAt.getTime() + int(7, 120) * DAY, now.getTime() - int(0, 5) * DAY)) : null;
      const lastActivity = new Date(Math.min(createdAt.getTime() + int(0, 90) * DAY, now.getTime()));
      const priceDrop = rand() < 0.15;
      const listed = priceDrop ? round(price * (1.03 + rand() * 0.1), listingType === 'SALE' ? 50_000 : 500) : price;
      const bhkLabel = bhk ? `${bhk} BHK ` : '';
      const id = pid++;
      properties.push({
        id,
        tenant_id: tenantId,
        title: `${bhkLabel}${typeName} ${listingType === 'RENT' ? 'for rent' : 'for sale'} in ${loc.name}`,
        type_id: type,
        status_id: sId,
        listing_type: listingType,
        bhk,
        furnishing: typeName === 'Plot' ? 'UNFURNISHED' : pick(['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED']),
        carpet_area_sqft: area,
        price_inr: price,
        listed_price_inr: listed,
        building_name: bName,
        unit_no: unitNo,
        floor,
        total_floors: totalFloors,
        locality_id: loc.id,
        city: loc.city,
        address: `${bName}, ${loc.name}, ${loc.city}`,
        owner_name: `${pick(FIRST)} ${pick(LAST)}`,
        owner_phone: `${pick(['9', '8', '7', '6'])}${String(int(0, 999_999_999)).padStart(9, '0')}`,
        assignee_id: rand() < 0.97 ? pick(agents) : null,
        created_by: pick(agents),
        is_stale: m.stageOf[sId] === 'OPEN' && now.getTime() - lastActivity.getTime() > 30 * DAY,
        last_activity_at: lastActivity,
        closed_at: closedAt,
        version: priceDrop ? 2 : 1,
        created_at: createdAt,
        updated_at: lastActivity,
        deleted_at: null,
      });
      const am = new Set<number>();
      const k = typeName === 'Plot' ? int(0, 2) : int(2, 6);
      while (am.size < k) am.add(pick(m.amenities));
      for (const a of am) amenityRows.push({ property_id: id, amenity_id: a });
      activityRows.push({
        tenant_id: tenantId,
        property_id: id,
        actor_id: null,
        action: 'CREATED',
        summary: `Listed`,
        diff: null,
        request_id: 'seed',
        created_at: createdAt,
      });
      if (priceDrop) {
        activityRows.push({
          tenant_id: tenantId,
          property_id: id,
          actor_id: properties[properties.length - 1].assignee_id as number | null,
          action: 'UPDATED',
          summary: 'Price reduced',
          diff: JSON.stringify({ priceInr: { from: listed, to: price } }),
          request_id: 'seed',
          created_at: new Date(createdAt.getTime() + DAY),
        });
      }
    }
  }
  console.log(`inserting ${properties.length} properties…`);
  await bulk('properties', properties);
  await bulk('property_amenities', amenityRows, 5000);
  await bulk('property_activity', activityRows, 2000);

  // ── notes, chat, site visits on 60 properties per tenant A agents (+10 for B) ──
  const notes: Row[] = [];
  const chats: Row[] = [];
  const visits: Row[] = [];
  const openA = properties.filter((p) => p.tenant_id === 1 && p.assignee_id && md[1].stageOf[p.status_id as number] === 'OPEN').slice(0, 60);
  const openB = properties.filter((p) => p.tenant_id === 2 && p.assignee_id && md[2].stageOf[p.status_id as number] === 'OPEN').slice(0, 10);
  const manager = (tid: number) => SEED_USERS.find((u) => u.tenantId === tid && u.role === 'MANAGER')!.id;
  let clientSeq = 1;
  for (const [i, p] of [...openA, ...openB].entries()) {
    const tid = p.tenant_id as number;
    const agent = p.assignee_id as number;
    const base = new Date(now.getTime() - int(1, 20) * DAY);
    notes.push({ tenant_id: tid, property_id: p.id, author_id: agent, body: pick(NOTES), created_at: base, updated_at: base });
    for (let c = 0; c < 4; c++) {
      const at = new Date(base.getTime() + c * 15 * 60_000);
      chats.push({
        tenant_id: tid,
        property_id: p.id,
        sender_id: c % 2 === 0 ? agent : manager(tid),
        client_msg_id: `seed-${String(clientSeq++).padStart(6, '0')}`,
        body: CHAT[(i + c) % CHAT.length],
        created_at: at,
      });
    }
    // Mix of past, today and upcoming visits, on :00/:30 (IST) slots between 09:00 and 19:00 IST.
    const dayOffset = i % 3 === 0 ? int(-10, -1) : i % 3 === 1 ? 0 : int(1, 20);
    const istHour = int(9, 18);
    const minute = pick([0, 30]);
    const d = new Date(now.getTime() + dayOffset * DAY);
    const visitUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), istHour, minute) - 330 * 60_000);
    visits.push({
      tenant_id: tid,
      property_id: p.id,
      agent_id: agent,
      visit_at_utc: visitUtc,
      duration_minutes: pick([30, 45, 60]),
      visitor_name: `${pick(FIRST)} ${pick(LAST)}`,
      visitor_phone: null,
      notes: 'Buyer referred by existing client',
      outcome: dayOffset < 0 ? pick(['COMPLETED', 'INTERESTED', 'NO_SHOW', 'SCHEDULED']) : 'SCHEDULED',
      reminded_at: dayOffset < 0 ? visitUtc : null,
      created_by: agent,
      created_at: base,
      updated_at: base,
    });
  }
  await bulk('property_notes', notes);
  await bulk('chat_messages', chats);
  await bulk('site_visits', visits);

  // Clear caches that could reference the old data.
  const keys = await redis.keys('md:*');
  const dash = await redis.keys('dash:*');
  if (keys.length + dash.length) await redis.del(...keys, ...dash);

  console.log(
    `crm seed done: ${properties.length} properties, ${amenityRows.length} amenity links, ${notes.length} notes, ${chats.length} chat messages, ${visits.length} site visits`,
  );
  await sequelize.close();
  await redis.quit();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
