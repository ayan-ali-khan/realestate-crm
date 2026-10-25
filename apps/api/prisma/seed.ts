// Deterministic seed data for local/dev use (Phase 1).
// - Pure builder functions (no DB) are exported so the data can be sanity-checked offline.
// - `main()` wipes and rewrites dev data; never run against a production database.
// - aiScore/aiScoreReason are intentionally NULL: only the real AI service (Phase 10)
//   may set them (no fabricated data).
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import type {
  LeadSource,
  LeadPriority,
  PipelineStage,
  PropertyType,
  PropertyStatus,
  ActivityType,
  TaskStatus,
  SiteVisitStatus,
  Role,
} from '../src/generated/prisma/client.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';
const BCRYPT_ROUNDS = 10;

// Deterministic PRNG (mulberry32) so reseeding produces identical data.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each builder re-seeds the shared stream so buildProperties()/buildLeads() are
// deterministic per call (entity choices identical; dates stay relative to "now" on purpose).
let rng = mulberry32(20261019);
const seedRng = (seed: number) => {
  rng = mulberry32(seed);
};
// noUncheckedIndexedAccess-safe accessor: crashes loudly instead of yielding undefined.
const at = <T>(arr: readonly T[], idx: number): T => {
  const value = arr[idx];
  if (value === undefined)
    throw new Error(`Index ${idx} out of bounds (array length ${arr.length})`);
  return value;
};
const pick = <T>(arr: readonly T[]): T => at(arr, Math.floor(rng() * arr.length));
// k distinct indices in [0, max) via partial Fisher–Yates — avoids duplicate
// (leadId, propertyId) pairs, which would collide with the LeadProperty primary key.
const sampleDistinct = (max: number, k: number): number[] => {
  const idx = Array.from({ length: max }, (_, i) => i);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rng() * (max - i));
    const tmp = at(idx, i);
    idx[i] = at(idx, j);
    idx[j] = tmp;
  }
  return idx.slice(0, k);
};
const intBetween = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date();
const daysFromNow = (days: number) => new Date(now().getTime() + days * DAY_MS);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const USERS = [
  { name: 'Amelia Rhodes', email: 'admin@crm.test', role: 'ADMIN' as Role },
  { name: 'Marcus Chen', email: 'manager@crm.test', role: 'MANAGER' as Role },
  { name: 'Sofia Almeida', email: 'agent@crm.test', role: 'AGENT' as Role },
];

const FIRST_NAMES = [
  'Liam',
  'Olivia',
  'Noah',
  'Emma',
  'Ava',
  'Elijah',
  'Sophia',
  'Mateo',
  'Isabella',
  'Lucas',
  'Mia',
  'Ethan',
  'Charlotte',
  'James',
  'Amelia',
  'Benjamin',
  'Harper',
  'Daniel',
  'Evelyn',
  'Henry',
  'Camila',
  'Sebastian',
  'Luna',
  'Jack',
  'Aria',
  'Owen',
  'Chloe',
  'Leo',
  'Penelope',
  'Ryan',
  'Nora',
  'Caleb',
  'Zo',
  'Nathan',
  'Layla',
  'Aaron',
  'Hannah',
  'Julian',
  'Stella',
  'Isaac',
];
const LAST_NAMES = [
  'Carter',
  'Nguyen',
  'Patel',
  'Kim',
  'Garcia',
  'Okafor',
  'Silva',
  'Novak',
  'Haddad',
  'Larsen',
  'Moreau',
  'Schmidt',
  'Rossi',
  'Yamada',
  'Dubois',
  'Andersson',
  'Costa',
  'Reyes',
  'Fischer',
  'Bauer',
];

const CITIES = [
  'Austin',
  'Denver',
  'Seattle',
  'Miami',
  'Chicago',
  'Phoenix',
  'Boston',
  'San Diego',
];
const SOURCES: LeadSource[] = [
  'WEBSITE',
  'REFERRAL',
  'ZILLOW',
  'WALK_IN',
  'COLD_CALL',
  'SOCIAL_MEDIA',
  'OTHER',
];
const PRIORITIES: LeadPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
// Weighted toward earlier stages: a realistic pipeline funnel, not a uniform spread.
const STAGES: PipelineStage[] = [
  'NEW_LEAD',
  'NEW_LEAD',
  'NEW_LEAD',
  'NEW_LEAD',
  'CONTACTED',
  'CONTACTED',
  'CONTACTED',
  'SITE_VISIT',
  'SITE_VISIT',
  'SITE_VISIT',
  'NEGOTIATION',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
];

const AMENITY_POOL = [
  'Pool',
  'Gym',
  'Garage',
  'Garden',
  'Balcony',
  'Elevator',
  'Concierge',
  'Solar Panels',
  'Fireplace',
  'Mountain View',
  'Sea View',
  'Pet Friendly',
  'Smart Home',
  'Security System',
];

const PROPERTY_SEEDS: Array<{
  title: string;
  type: PropertyType;
  city: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number;
}> = [
  {
    title: 'Downtown Skyline Loft',
    type: 'APARTMENT',
    city: 'Austin',
    price: 520_000,
    bedrooms: 2,
    bathrooms: 2,
    areaSqft: 1100,
  },
  {
    title: 'Zilker Garden Bungalow',
    type: 'HOUSE',
    city: 'Austin',
    price: 845_000,
    bedrooms: 3,
    bathrooms: 2,
    areaSqft: 1850,
  },
  {
    title: 'RiNo Arts District Studio',
    type: 'APARTMENT',
    city: 'Denver',
    price: 340_000,
    bedrooms: 1,
    bathrooms: 1,
    areaSqft: 620,
  },
  {
    title: 'Cherry Creek Family Home',
    type: 'HOUSE',
    city: 'Denver',
    price: 1_120_000,
    bedrooms: 4,
    bathrooms: 3,
    areaSqft: 2600,
  },
  {
    title: 'Capitol Hill View Condo',
    type: 'APARTMENT',
    city: 'Seattle',
    price: 690_000,
    bedrooms: 2,
    bathrooms: 2,
    areaSqft: 1050,
  },
  {
    title: 'Ballard Canal Townhouse',
    type: 'TOWNHOUSE',
    city: 'Seattle',
    price: 935_000,
    bedrooms: 3,
    bathrooms: 3,
    areaSqft: 1750,
  },
  {
    title: 'Brickell Waterfront Villa',
    type: 'VILLA',
    city: 'Miami',
    price: 2_450_000,
    bedrooms: 5,
    bathrooms: 5,
    areaSqft: 4200,
  },
  {
    title: 'Coconut Grove Patio Apartment',
    type: 'APARTMENT',
    city: 'Miami',
    price: 575_000,
    bedrooms: 2,
    bathrooms: 1,
    areaSqft: 950,
  },
  {
    title: 'Logan Square Classic Brownstone',
    type: 'HOUSE',
    city: 'Chicago',
    price: 780_000,
    bedrooms: 4,
    bathrooms: 2,
    areaSqft: 2300,
  },
  {
    title: 'River North Executive Suite',
    type: 'APARTMENT',
    city: 'Chicago',
    price: 610_000,
    bedrooms: 2,
    bathrooms: 2,
    areaSqft: 1150,
  },
  {
    title: 'Arcadia Desert Retreat',
    type: 'HOUSE',
    city: 'Phoenix',
    price: 660_000,
    bedrooms: 4,
    bathrooms: 3,
    areaSqft: 2450,
  },
  {
    title: 'Old Town Mixed-Use Retail',
    type: 'COMMERCIAL',
    city: 'Phoenix',
    price: 890_000,
    bedrooms: 0,
    bathrooms: 2,
    areaSqft: 3100,
  },
  {
    title: 'Back Bay Brownstone Penthouse',
    type: 'APARTMENT',
    city: 'Boston',
    price: 1_650_000,
    bedrooms: 3,
    bathrooms: 3,
    areaSqft: 2100,
  },
  {
    title: 'Seaport Development Parcel',
    type: 'LAND',
    city: 'Boston',
    price: 1_200_000,
    bedrooms: 0,
    bathrooms: 0,
    areaSqft: 8700,
  },
  {
    title: 'La Jolla Cliffside Villa',
    type: 'VILLA',
    city: 'San Diego',
    price: 3_100_000,
    bedrooms: 5,
    bathrooms: 4,
    areaSqft: 4600,
  },
];

// ---------------------------------------------------------------------------
// Pure builders (no DB access) — sanity-checked offline in Phase 1 verification.
// ---------------------------------------------------------------------------

export interface SeedLead {
  name: string;
  email: string;
  phone: string;
  source: LeadSource;
  budgetMin: number;
  budgetMax: number;
  preferredLocation: string;
  stage: PipelineStage;
  priority: LeadPriority;
  assignedToIdx: number | null; // index into USERS
  convertedToCustomer: boolean;
  deletedAt: Date | null;
  activities: Array<{
    type: ActivityType;
    content: string;
    userId: number | null;
    metadata?: Record<string, string>;
  }>;
  tasks: Array<{
    title: string;
    dueAt: Date;
    status: TaskStatus;
    assigneeIdx: number;
    createdBy: 'USER' | 'AI';
  }>;
  inquiries: Array<{ propertyIdx: number; note: string }>;
  siteVisits: Array<{ propertyIdx: number; scheduledAt: Date; status: SiteVisitStatus }>;
}

export interface SeedProperty {
  title: string;
  description: string;
  price: number;
  location: string;
  city: string;
  type: PropertyType;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number;
  amenities: string[];
  images: string[];
  status: PropertyStatus;
}

export function buildProperties(): SeedProperty[] {
  seedRng(20261019);
  return PROPERTY_SEEDS.map((p, i) => {
    const amenities = [
      ...new Set(Array.from({ length: intBetween(2, 5) }, () => pick(AMENITY_POOL))),
    ];
    const status: PropertyStatus = i % 7 === 3 ? 'SOLD' : i % 5 === 2 ? 'RESERVED' : 'AVAILABLE';
    return {
      title: p.title,
      description: `${p.bedrooms > 0 ? `${p.bedrooms}-bedroom ` : ''}${p.type.toLowerCase()} in ${p.city}. Spacious (${p.areaSqft} sqft) with modern finishes and convenient access to local amenities.`,
      price: p.price,
      location: `${intBetween(100, 9800)} ${pick(['Oak', 'Elm', 'Cedar', 'Maple', 'Birch', 'Juniper'])} ${pick(['St', 'Ave', 'Blvd', 'Dr'])}`,
      city: p.city,
      type: p.type,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      areaSqft: p.areaSqft,
      amenities,
      images: Array.from(
        { length: intBetween(2, 4) },
        (_, k) => `https://picsum.photos/seed/prop-${i}-${k}/800/600`,
      ),
      status,
    };
  });
}

export function buildLeads(): SeedLead[] {
  seedRng(20261020);
  return Array.from({ length: 40 }, (_, i) => {
    const name = `${FIRST_NAMES[i]} ${pick(LAST_NAMES)}`;
    const stage = at(STAGES, i % STAGES.length);
    const budgetMin = intBetween(3, 90) * 10_000;
    const budgetMax = budgetMin + intBetween(10, 120) * 10_000;
    const preferredLocation = pick(CITIES);
    const priority = pick(PRIORITIES);
    const source = pick(SOURCES);
    const agentIdx = intBetween(1, 2); // manager or agent owns leads; admin oversees
    const isClosed = stage === 'CLOSED_WON' || stage === 'CLOSED_LOST';

    const activities: SeedLead['activities'] = [
      {
        type: 'NOTE',
        content: `Lead captured via ${source.toLowerCase()}; initial qualification call booked.`,
        userId: agentIdx,
      },
    ];
    if (stage !== 'NEW_LEAD') {
      activities.push({
        type: 'CALL',
        content: 'Discussed budget, timeline and must-have features.',
        userId: agentIdx,
      });
    }
    if (stage === 'SITE_VISIT' || stage === 'NEGOTIATION' || stage === 'CLOSED_WON') {
      activities.push({
        type: 'SITE_VISIT',
        content: 'Accompanied client to property viewing; positive feedback.',
        userId: agentIdx,
      });
    }
    if (stage === 'NEGOTIATION' || stage === 'CLOSED_WON') {
      activities.push({
        type: 'EMAIL',
        content: 'Sent revised offer with updated closing timeline.',
        userId: agentIdx,
      });
    }
    if (stage === 'CLOSED_WON') {
      activities.push({
        type: 'STAGE_CHANGE',
        content: 'Moved lead to CLOSED_WON.',
        userId: agentIdx,
        metadata: { from: 'NEGOTIATION', to: 'CLOSED_WON' },
      });
    }
    if (isClosed && i % 3 !== 0) {
      activities.push({
        type: 'NOTE',
        content: 'Client paused the search; revisit next quarter.',
        userId: agentIdx,
      });
    }

    const tasks: SeedLead['tasks'] = [];
    if (!isClosed) {
      tasks.push(
        {
          title: 'Qualification follow-up call',
          dueAt: daysFromNow(intBetween(-4, 6)),
          status: rng() < 0.75 ? 'PENDING' : 'DONE',
          assigneeIdx: agentIdx,
          createdBy: 'USER',
        },
        {
          title: 'Share matching property shortlist',
          dueAt: daysFromNow(intBetween(1, 9)),
          status: 'PENDING',
          assigneeIdx: agentIdx,
          createdBy: rng() < 0.3 ? 'AI' : 'USER',
        },
      );
    } else if (stage === 'CLOSED_WON') {
      tasks.push({
        title: 'Schedule closing paperwork review',
        dueAt: daysFromNow(intBetween(-3, 10)),
        status: 'PENDING',
        assigneeIdx: agentIdx,
        createdBy: 'USER',
      });
    }

    const inquiries: SeedLead['inquiries'] = sampleDistinct(
      PROPERTY_SEEDS.length,
      intBetween(0, 3),
    ).map((propertyIdx) => ({
      propertyIdx,
      note: pick([
        'Asked about the neighborhood schools.',
        'Interested but wants a smaller price point.',
        'Loved the layout; asked about HOA fees.',
        'Requested a second viewing with family.',
      ]),
    }));

    const siteVisits: SeedLead['siteVisits'] =
      stage === 'SITE_VISIT' || stage === 'NEGOTIATION' || stage === 'CLOSED_WON'
        ? [
            {
              propertyIdx: intBetween(0, PROPERTY_SEEDS.length - 1),
              scheduledAt:
                stage === 'SITE_VISIT'
                  ? daysFromNow(intBetween(1, 10))
                  : daysFromNow(-intBetween(3, 30)),
              status: stage === 'SITE_VISIT' ? 'SCHEDULED' : 'COMPLETED',
            },
          ]
        : [];

    return {
      name,
      email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`,
      phone: `+1-555-${String(intBetween(100, 999))}${String(intBetween(1000, 9999))}`,
      source,
      budgetMin,
      budgetMax,
      preferredLocation,
      stage,
      priority,
      assignedToIdx: rng() < 0.9 ? agentIdx : null,
      convertedToCustomer: stage === 'CLOSED_WON',
      deletedAt: i === 37 ? daysFromNow(-2) : null, // one soft-deleted lead for list-filter coverage
      activities,
      tasks,
      inquiries,
      siteVisits,
    };
  });
}

// ---------------------------------------------------------------------------
// DB write
// ---------------------------------------------------------------------------

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
  const properties = buildProperties();
  const leads = buildLeads();

  // Wipe in FK-safe order (children first). Seeding runs against a remote
  // cloud database, where 7 batched full-table deletes can exceed Prisma's
  // default 5s interactive-transaction budget — allow 30s.
  await prisma.$transaction(
    [
      prisma.siteVisit.deleteMany(),
      prisma.leadProperty.deleteMany(),
      prisma.activity.deleteMany(),
      prisma.task.deleteMany(),
      prisma.lead.deleteMany(),
      prisma.property.deleteMany(),
      prisma.user.deleteMany(),
    ],
    { timeout: 30_000 },
  );

  const createdUsers: Array<{ id: string }> = [];
  for (const u of USERS) {
    createdUsers.push(
      await prisma.user.create({
        data: { name: u.name, email: u.email, passwordHash, role: u.role },
      }),
    );
  }

  const createdProperties: Array<{ id: string }> = [];
  for (const p of properties) {
    createdProperties.push(await prisma.property.create({ data: p }));
  }

  // Chunked: all 40 leads in ONE interactive transaction exceeded the 60s
  // budget on the remote database (P2028 — dozens of sequential nested-create
  // round trips). Each 10-lead chunk stays atomic, and because the wipe above
  // always runs first, a failed seed is fully repaired by simply rerunning it.
  const CHUNK_SIZE = 10;
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    await prisma.$transaction(
      leads.slice(i, i + CHUNK_SIZE).map((l) => {
        const { assignedToIdx, inquiries, activities, tasks, siteVisits, ...leadData } = l;
        return prisma.lead.create({
          data: {
            ...leadData,
            assignedTo:
              assignedToIdx === null
                ? undefined
                : { connect: { id: at(createdUsers, assignedToIdx).id } },
            activities: {
              create: activities.map(({ userId, ...a }) => ({
                ...a,
                user:
                  userId === null ? undefined : { connect: { id: at(createdUsers, userId).id } },
              })),
            },
            tasks: {
              create: tasks.map((t) => ({
                title: t.title,
                dueAt: t.dueAt,
                status: t.status,
                createdBy: t.createdBy,
                isOverdue: t.status === 'PENDING' && t.dueAt < now(),
                assignee: { connect: { id: at(createdUsers, t.assigneeIdx).id } },
              })),
            },
            inquiries: {
              create: inquiries.map((q) => ({
                note: q.note,
                property: { connect: { id: at(createdProperties, q.propertyIdx).id } },
              })),
            },
            siteVisits: {
              create: siteVisits.map((v) => ({
                scheduledAt: v.scheduledAt,
                status: v.status,
                property: { connect: { id: at(createdProperties, v.propertyIdx).id } },
              })),
            },
          },
        });
      }),
      { timeout: 60_000 },
    );
  }

  console.log(
    `Seeded ${createdUsers.length} users, ${createdProperties.length} properties, ${leads.length} leads.`,
  );
  console.log(
    `Login with admin@crm.test / manager@crm.test / agent@crm.test — password: ${SEED_PASSWORD}`,
  );
  await prisma.$disconnect();
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
