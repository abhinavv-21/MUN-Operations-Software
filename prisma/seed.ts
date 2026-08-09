/**
 * A conference with enough in it to design against.
 *
 * The gap this closes is not developer comfort. Every screen in this product
 * looks fine with four rows in it; the ones that matter are the register with
 * three hundred names on a phone, the allocations board with six committees
 * part-filled, and the audit log with a page of entries that all look alike.
 * You cannot judge those designs against an empty table, and until now every
 * browser check in the repository seeded its own fixture with raw SQL — which
 * is what a missing seed looks like from the outside.
 *
 * ```bash
 * npm run db:seed                       # a demo organisation, unreachable by anyone
 * SEED_EMAIL=you@example.com npm run db:seed   # …owned by an account you can sign in as
 * ```
 *
 * `SEED_EMAIL` is the useful form. Supabase owns credentials, so this cannot
 * create an account you can sign in with — what it can do is attach the demo
 * organisation to the `User` row that your existing Supabase account already
 * provisioned on first sign-in. Sign in once, then run the seed with your
 * address, and the conference is there when you reload.
 *
 * It is destructive and says so: it drops any organisation on `SEED_SLUG`
 * first, so re-running gives the same result rather than a second copy. It
 * refuses to run against anything that is not obviously a development database.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.ts'
import type {
  AttendanceStatus,
  LogisticsCategory,
  LogisticsPriority,
  LogisticsStatus,
  RegistrationStatus,
} from '../src/generated/prisma/enums.ts'

const SLUG = process.env.SEED_SLUG ?? 'demo-mun-society'
const OWNER_EMAIL = process.env.SEED_EMAIL ?? 'owner@demo.invalid'

/**
 * The Supabase subject, when you have one.
 *
 * Provisioning looks a user up by `authUserId`, never by email, so a seeded row
 * carrying a made-up subject and a real address is worse than no row at all: the
 * next sign-in fails to match it, tries to create a second row, and collides on
 * the unique email. Passing the real subject makes the seeded organisation
 * belong to the account you actually sign in with.
 *
 *     SEED_EMAIL=you@example.com SEED_AUTH_USER_ID=<supabase sub> npm run db:seed
 */
const OWNER_AUTH_ID = process.env.SEED_AUTH_USER_ID

/* -------------------------------------------------------------------------- */
/* Guardrails                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Refuses to run anywhere that looks like it matters.
 *
 * A seed is a `deleteMany` with good intentions, and the accident it is one
 * typo away from is running against Supabase. Checked against the URL rather
 * than against `NODE_ENV`, because `NODE_ENV` is whatever the last shell said.
 */
function assertDevelopmentDatabase(url: string): void {
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  })()

  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (local) return

  throw new Error(
    `The seed refuses to run against ${host || 'that URL'}. It deletes and rewrites an ` +
      `organisation, and it is meant for local Postgres only. If you genuinely want this, ` +
      `point DATABASE_URL at a local database first.`,
  )
}

/* -------------------------------------------------------------------------- */
/* Material                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Names chosen to look like a real Indian school circuit, with the diacritics
 * and the double-barrelled surnames that break naive column widths and PDF
 * encodings. That is the point of them: a seed of "Test User 1..120" makes
 * every layout look better than it is.
 */
const FIRST_NAMES = [
  'Aarav', 'Ananya', 'Vihaan', 'Diya', 'Arjun', 'Ishaan', 'Saanvi', 'Kabir',
  'Meera', 'Rohan', 'Anika', 'Vivaan', 'Nikhil', 'Riya', 'Aditya', 'Zoya',
  'Farhan', 'Tanvi', 'Dhruv', 'Kiara', 'Neha', 'Yash', 'Ira', 'Advait',
  'Sana', 'Reyansh', 'Myra', 'Aryan', 'Aisha', 'Kunal', 'Zoë', 'Mihir',
  'Nandini', 'Rehan', 'Pari', 'Shaurya', 'Avni', 'Krish', 'Trisha', 'Om',
]

const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Khan', 'Banerjee', 'Chatterjee',
  'Mehta', 'Kapoor', 'Rao', 'Gupta', 'Singh', 'Joshi', 'Menon', 'Desai',
  'Bhatt', 'Kulkarni', 'Pillai', 'Sengupta', 'Ahuja', 'D’Souza', 'Fernandes',
  'Mukherjee', 'Chowdhury', 'Saxena', 'Trivedi', 'Ganguly', 'Bose', 'Nayar',
]

const SCHOOLS = [
  'Lucknow Public School',
  'City Montessori School',
  'La Martiniere College',
  'St. Francis’ College',
  'Delhi Public School, Indira Nagar',
  'Seth M.R. Jaipuria School',
  'Study Hall School',
  'Loreto Convent',
  'Colvin Taluqdars’ College',
  'Cathedral & John Connon School',
]

const COMMITTEES = [
  {
    code: 'UNSC',
    name: 'United Nations Security Council',
    seats: 15,
    countries: [
      'United States', 'United Kingdom', 'France', 'Russian Federation', 'China',
      'India', 'Brazil', 'Nigeria', 'Kenya', 'Japan', 'Germany', 'Mexico',
      'Slovenia', 'Guyana', 'Algeria',
    ],
  },
  {
    code: 'UNHRC',
    name: 'United Nations Human Rights Council',
    seats: 24,
    countries: [
      'Argentina', 'Bangladesh', 'Belgium', 'Benin', 'Bolivia', 'Bulgaria',
      'Chile', 'Costa Rica', 'Côte d’Ivoire', 'Cuba', 'Finland', 'Georgia',
      'Ghana', 'Indonesia', 'Kuwait', 'Malawi', 'Maldives', 'Morocco',
      'Netherlands', 'Qatar', 'Romania', 'South Africa', 'Viet Nam', 'Sudan',
    ],
  },
  {
    code: 'WHO',
    name: 'World Health Organization',
    seats: 20,
    countries: [
      'Australia', 'Austria', 'Canada', 'Colombia', 'Denmark', 'Egypt',
      'Ethiopia', 'Iceland', 'Ireland', 'Israel', 'Italy', 'Jordan',
      'Malaysia', 'New Zealand', 'Norway', 'Peru', 'Philippines', 'Poland',
      'Portugal', 'Rwanda',
    ],
  },
  {
    code: 'DISEC',
    name: 'Disarmament and International Security Committee',
    seats: 22,
    countries: [
      'Armenia', 'Belarus', 'Cambodia', 'Croatia', 'Cyprus', 'Czechia',
      'Ecuador', 'Estonia', 'Greece', 'Hungary', 'Iran', 'Iraq', 'Kazakhstan',
      'Latvia', 'Lebanon', 'Lithuania', 'Nepal', 'Pakistan', 'Serbia',
      'Sri Lanka', 'Türkiye', 'Ukraine',
    ],
  },
  {
    code: 'ECOSOC',
    name: 'Economic and Social Council',
    seats: 18,
    countries: [
      'Angola', 'Bahrain', 'Botswana', 'Cameroon', 'Chad', 'Congo', 'Gabon',
      'Guatemala', 'Honduras', 'Jamaica', 'Mali', 'Namibia', 'Panama',
      'Paraguay', 'Senegal', 'Tanzania', 'Uganda', 'Zambia',
    ],
  },
  {
    // No matrix at all. A supported state that the allocations board renders
    // differently, and one nobody would think to seed by hand.
    code: 'IPC',
    name: 'International Press Corps',
    seats: null,
    countries: [] as string[],
  },
]

const LOGISTICS: {
  title: string
  detail: string | null
  category: LogisticsCategory
  priority: LogisticsPriority
  status: LogisticsStatus
  resolution: string | null
  committee: string | null
}[] = [
  {
    title: 'Projector in UNSC has no signal',
    detail: 'Room 204. The HDMI cable is missing from the podium.',
    category: 'TECHNICAL', priority: 'URGENT', status: 'OPEN',
    resolution: null, committee: 'UNSC',
  },
  {
    title: 'A delegate in DISEC has fainted',
    detail: 'Sitting down in the corridor, conscious. Needs water and the nurse.',
    category: 'MEDICAL', priority: 'URGENT', status: 'IN_PROGRESS',
    resolution: null, committee: 'DISEC',
  },
  {
    title: 'Water coolers for the second floor',
    detail: null,
    category: 'REFRESHMENT', priority: 'NORMAL', status: 'IN_PROGRESS',
    resolution: null, committee: null,
  },
  {
    title: 'Two more mics for UNHRC',
    detail: 'Forty-odd delegates and one roaming mic is slowing the speakers list.',
    category: 'EQUIPMENT', priority: 'NORMAL', status: 'OPEN',
    resolution: null, committee: 'UNHRC',
  },
  {
    title: 'Placards missing for four ECOSOC countries',
    detail: 'Angola, Chad, Gabon, Namibia.',
    category: 'STATIONERY', priority: 'NORMAL', status: 'RESOLVED',
    resolution: 'Reprinted at the front desk and delivered before session two.',
    committee: 'ECOSOC',
  },
  {
    title: 'Pens for the press corps',
    detail: null,
    category: 'STATIONERY', priority: 'LOW', status: 'RESOLVED',
    resolution: 'Two boxes from the store room.', committee: 'IPC',
  },
  {
    title: 'Bus for the Jaipuria delegation at 17:30',
    detail: 'Twelve delegates plus two faculty advisors.',
    category: 'TRANSPORT', priority: 'NORMAL', status: 'OPEN',
    resolution: null, committee: null,
  },
  {
    title: 'Lunch count is short by about thirty',
    detail: 'Caterer counted registrations, not approvals.',
    category: 'REFRESHMENT', priority: 'URGENT', status: 'RESOLVED',
    resolution: 'Caterer sent forty more at 12:20. Count from approvals next year.',
    committee: null,
  },
  {
    title: 'Air conditioning in WHO',
    detail: 'Room is warm. Reported twice.',
    category: 'OTHER', priority: 'LOW', status: 'CANCELLED',
    resolution: 'Building manager says the unit is off for the whole floor today.',
    committee: 'WHO',
  },
]

const AWARDS = [
  { title: 'Best Delegate', rank: 1 },
  { title: 'High Commendation', rank: 2 },
  { title: 'Special Mention', rank: 3 },
]

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A seeded PRNG, so two runs produce the same conference.
 *
 * `Math.random` would mean every screenshot differs from the last and no visual
 * change could be told apart from noise.
 */
function makeRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const random = makeRandom(20260314)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
const chance = (probability: number) => random() < probability

/** `2026-03-14` for a `DATE` column, with no timezone anywhere near it. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/**
 * Dates relative to whenever the seed is run, not fixed to a calendar.
 *
 * A seed with hard-coded 2026 dates shows the interesting screens for about a
 * fortnight and then quietly rots: the registration page starts saying
 * "registration has closed", and the dashboard register — which asks about
 * *today* — is empty for a conference that finished months ago. Found exactly
 * that way, by screenshotting the public page and reading it.
 */
const TODAY = new Date()
const shiftDays = (offset: number) => {
  const date = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), TODAY.getUTCDate()))
  date.setUTCDate(date.getUTCDate() + offset)
  return date
}
const isoDay = (offset: number) => shiftDays(offset).toISOString().slice(0, 10)

/* -------------------------------------------------------------------------- */
/* Seed                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
  assertDevelopmentDatabase(connectionString)

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  console.log(`Seeding ${SLUG}, owned by ${OWNER_EMAIL}`)

  // Destructive and deliberate: re-running replaces rather than duplicates.
  await db.organization.deleteMany({ where: { slug: SLUG } })

  const organization = await db.organization.create({
    data: { slug: SLUG, name: 'Lucknow Model United Nations Society' },
  })

  /*
    Attached to whatever `User` row already exists for this address.

    Supabase owns credentials, so a seed cannot mint an account anybody can sign
    in as. What it can do is hand the organisation to the row that your own
    account provisioned on first sign-in — which is the difference between a
    demo you can look at and a demo you can use.
  */
  const owner = await db.user.findUnique({ where: { email: OWNER_EMAIL } })
  const ownerId =
    owner?.id ??
    (
      await db.user.create({
        data: {
          authUserId: OWNER_AUTH_ID ?? `seed:${OWNER_EMAIL}`,
          email: OWNER_EMAIL,
          fullName: 'Priya Raman',
          firstName: 'Priya',
          lastName: 'Raman',
          profileCompletedAt: new Date(),
        },
      })
    ).id

  if (!owner && !OWNER_AUTH_ID) {
    console.log(
      `  no account exists for ${OWNER_EMAIL} and no SEED_AUTH_USER_ID was given, so nobody ` +
        `can sign in to this organisation. Sign in once with a real address, then re-run with ` +
        `SEED_EMAIL=<that address>.`,
    )
  }

  await db.membership.create({
    data: { userId: ownerId, organizationId: organization.id, role: 'OWNER', canManageMembers: true },
  })

  // A second person, so the members screen and the audit log have more than one
  // name in them and ownership transfer has somewhere to go.
  const deputy = await db.user.upsert({
    where: { email: 'deputy@demo.invalid' },
    update: {},
    create: {
      authUserId: 'seed:deputy@demo.invalid',
      email: 'deputy@demo.invalid',
      fullName: 'Arjun Sengupta',
      profileCompletedAt: new Date(),
    },
  })
  await db.membership.create({
    data: { userId: deputy.id, organizationId: organization.id, role: 'ADMIN', canManageMembers: false },
  })

  /* ---- The finished conference, so the switcher has history ------------- */

  await db.conference.create({
    data: {
      organizationId: organization.id,
      slug: 'lmuns-x',
      name: 'LMUNS X',
      edition: 'X',
      status: 'ARCHIVED',
      venue: 'La Martiniere College, Lucknow',
      startsOn: shiftDays(-178),
      endsOn: shiftDays(-176),
    },
  })

  /* ---- The live one ------------------------------------------------------ */

  const conference = await db.conference.create({
    data: {
      organizationId: organization.id,
      slug: 'lmuns-xi',
      name: 'LMUNS XI',
      edition: 'XI',
      status: 'OPEN',
      venue: 'Lucknow Public School, Sector 14',
      // Running right now, so the register, the dashboard and the logistics
      // board all show the state they are designed for.
      startsOn: shiftDays(0),
      endsOn: shiftDays(1),
      registrationDeadline: shiftDays(-14),
      feeMinorUnits: 150_000,
      feeCurrency: 'INR',
    },
  })

  await db.conferenceRole.create({
    data: { userId: deputy.id, conferenceId: conference.id, role: 'ADMIN' },
  })

  /*
    Next year's conference, with registration open and nothing in it yet.

    The live conference above has already started, so its public page correctly
    says registration has closed — which means without this one there is no way
    to look at the registration *form*, which is the highest-traffic page in the
    product and the only one a delegate ever sees.
  */
  await db.conference.create({
    data: {
      organizationId: organization.id,
      slug: 'lmuns-xii',
      name: 'LMUNS XII',
      edition: 'XII',
      status: 'OPEN',
      venue: 'To be announced',
      startsOn: shiftDays(210),
      endsOn: shiftDays(212),
      registrationDeadline: shiftDays(180),
      feeMinorUnits: 165_000,
      feeCurrency: 'INR',
    },
  })

  const committees = await Promise.all(
    COMMITTEES.map((committee) =>
      db.committee.create({
        data: {
          conferenceId: conference.id,
          code: committee.code,
          name: committee.name,
          seats: committee.seats,
        },
      }),
    ),
  )

  const byCode = new Map(committees.map((committee) => [committee.code, committee]))

  await db.committeeCountry.createMany({
    data: COMMITTEES.flatMap((committee) =>
      committee.countries.map((country) => ({
        conferenceId: conference.id,
        committeeId: byCode.get(committee.code)!.id,
        country,
        // A handful of double delegations, because the parser supports them and
        // nothing else in the product would show one.
        seats: chance(0.12) ? 2 : 1,
      })),
    ),
  })

  /* ---- Applications, in every state -------------------------------------- */

  const used = new Set<string>()
  const person = () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const first = pick(FIRST_NAMES)
      const last = pick(LAST_NAMES)
      const email = `${first}.${last}`
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z.]/g, '')
        .concat('@school.invalid')
      if (used.has(email)) continue
      used.add(email)
      return { fullName: `${first} ${last}`, email }
    }
    throw new Error('ran out of distinct names')
  }

  const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let referenceCounter = 0
  const reference = () => {
    referenceCounter += 1
    let value = ''
    let n = referenceCounter * 7919
    for (let i = 0; i < 6; i += 1) {
      value += REFERENCE_ALPHABET[n % REFERENCE_ALPHABET.length]
      n = Math.floor(n / REFERENCE_ALPHABET.length) + 31
    }
    return value
  }

  const APPROVED = 96
  const PENDING = 23
  const REJECTED = 7

  const approvedPeople = Array.from({ length: APPROVED }, person)

  await db.registration.createMany({
    data: [
      ...approvedPeople.map((who) => ({
        conferenceId: conference.id,
        reference: reference(),
        fullName: who.fullName,
        email: who.email,
        phone: `+91 9${Math.floor(random() * 900_000_000 + 100_000_000)}`,
        schoolName: pick(SCHOOLS),
        grade: pick(['9', '10', '11', '12', 'Undergraduate']),
        committeePreference: pick(COMMITTEES).code,
        munsAttended: Math.floor(random() * 8),
        awardsWon: Math.floor(random() * 3),
        status: 'APPROVED' as RegistrationStatus,
        reviewedAt: shiftDays(-20),
        reviewedByUserId: ownerId,
      })),
      ...Array.from({ length: PENDING }, () => {
        const who = person()
        return {
          conferenceId: conference.id,
          reference: reference(),
          fullName: who.fullName,
          email: who.email,
          phone: `+91 9${Math.floor(random() * 900_000_000 + 100_000_000)}`,
          schoolName: pick(SCHOOLS),
          grade: pick(['9', '10', '11', '12']),
          committeePreference: pick(COMMITTEES).code,
          munsAttended: Math.floor(random() * 5),
          status: 'PENDING' as RegistrationStatus,
        }
      }),
      ...Array.from({ length: REJECTED }, () => {
        const who = person()
        return {
          conferenceId: conference.id,
          reference: reference(),
          fullName: who.fullName,
          email: who.email,
          schoolName: pick(SCHOOLS),
          status: 'REJECTED' as RegistrationStatus,
          reviewedAt: shiftDays(-19),
          reviewedByUserId: ownerId,
          rejectionReason: pick([
            'Applied after the deadline.',
            'No payment received by the cut-off.',
            'Duplicate of an earlier application.',
          ]),
        }
      }),
    ],
  })

  const approvedRegistrations = await db.registration.findMany({
    where: { conferenceId: conference.id, status: 'APPROVED' },
    orderBy: { reference: 'asc' },
  })

  await db.delegate.createMany({
    data: approvedRegistrations.map((registration) => ({
      conferenceId: conference.id,
      fullName: registration.fullName,
      email: registration.email,
      phone: registration.phone,
      schoolName: registration.schoolName,
      grade: registration.grade,
      registrationId: registration.id,
    })),
  })

  const delegates = await db.delegate.findMany({
    where: { conferenceId: conference.id },
    orderBy: { fullName: 'asc' },
  })

  /* ---- Allocations, deliberately incomplete ------------------------------ */

  const matrix = await db.committeeCountry.findMany({
    where: { conferenceId: conference.id },
    orderBy: [{ committeeId: 'asc' }, { country: 'asc' }],
  })

  const free = new Map<string, string[]>()
  for (const row of matrix) {
    const list = free.get(row.committeeId) ?? []
    list.push(row.country)
    free.set(row.committeeId, list)
  }

  const assignments: { committeeId: string; delegateId: string; country: string }[] = []
  const committeeIds = committees.filter((committee) => free.get(committee.id)?.length).map((c) => c.id)

  for (const delegate of delegates) {
    // Roughly one in seven left unallocated. "Unallocated" is the filter an
    // organiser lives in, and a board with none of them tests nothing.
    if (chance(0.14)) continue
    const committeeId = committeeIds[assignments.length % committeeIds.length]!
    const countries = free.get(committeeId)
    if (!countries?.length) continue
    assignments.push({ committeeId, delegateId: delegate.id, country: countries.shift()! })
  }

  await db.assignment.createMany({
    data: assignments.map((assignment) => ({ conferenceId: conference.id, ...assignment })),
  })

  /* ---- Two days of register ---------------------------------------------- */

  // Today and tomorrow, matching the conference. The dashboard asks about
  // today; a register keyed to a date in the past renders as "nobody marked".
  for (const [index, date] of [isoDay(0), isoDay(1)].entries()) {
    await db.attendanceRecord.createMany({
      data: delegates
        // Day one is nearly complete; day two is mid-morning and half done, so
        // the register has both shapes in it.
        .filter(() => (index === 0 ? chance(0.93) : chance(0.52)))
        .map((delegate) => ({
          conferenceId: conference.id,
          delegateId: delegate.id,
          day: day(date),
          status: (chance(0.9) ? 'PRESENT' : chance(0.6) ? 'LATE' : 'ABSENT') as AttendanceStatus,
          markedByUserId: chance(0.7) ? ownerId : deputy.id,
          markedAt: new Date(`${date}T0${index === 0 ? 8 : 9}:${Math.floor(random() * 59)
            .toString()
            .padStart(2, '0')}:00Z`),
        })),
    })
  }

  /* ---- The board --------------------------------------------------------- */

  await db.logisticsRequest.createMany({
    data: LOGISTICS.map((request) => ({
      conferenceId: conference.id,
      committeeId: request.committee ? byCode.get(request.committee)!.id : null,
      category: request.category,
      priority: request.priority,
      status: request.status,
      title: request.title,
      detail: request.detail,
      resolution: request.resolution,
      requestedByUserId: chance(0.5) ? ownerId : deputy.id,
      ...(request.status === 'RESOLVED' || request.status === 'CANCELLED'
        ? { resolvedAt: new Date('2026-03-14T13:05:00Z'), resolvedByUserId: deputy.id }
        : {}),
    })),
  })

  /* ---- Awards, for the committees that are done -------------------------- */

  const awardable = ['UNSC', 'UNHRC', 'WHO']
  for (const code of awardable) {
    const committee = byCode.get(code)!
    const seated = assignments.filter((assignment) => assignment.committeeId === committee.id)
    for (const [index, award] of AWARDS.entries()) {
      const seat = seated[index]
      if (!seat) continue
      await db.award.create({
        data: {
          conferenceId: conference.id,
          committeeId: committee.id,
          delegateId: seat.delegateId,
          title: award.title,
          rank: award.rank,
          awardedByUserId: ownerId,
        },
      })
    }
  }

  /* ---- Something in the log ---------------------------------------------- */

  await db.auditLog.createMany({
    data: [
      { action: 'organization.create', entityType: 'Organization', entityId: organization.id, conferenceId: null },
      { action: 'conference.create', entityType: 'Conference', entityId: conference.id, conferenceId: conference.id },
      { action: 'matrix.import', entityType: 'Conference', entityId: conference.id, conferenceId: conference.id },
      { action: 'registration.import', entityType: 'Conference', entityId: conference.id, conferenceId: conference.id },
      { action: 'membership.update', entityType: 'Membership', entityId: deputy.id, conferenceId: null },
    ].map((row) => ({
      organizationId: organization.id,
      actorUserId: ownerId,
      ip: '203.0.113.7',
      ...row,
    })),
  })

  const counts = {
    committees: committees.length,
    countries: matrix.length,
    registrations: APPROVED + PENDING + REJECTED,
    delegates: delegates.length,
    allocated: assignments.length,
    attendance: await db.attendanceRecord.count({ where: { conferenceId: conference.id } }),
    logistics: LOGISTICS.length,
    awards: await db.award.count({ where: { conferenceId: conference.id } }),
  }

  console.log(`  running now:      /app/${SLUG}/conferences/${conference.id}`)
  console.log(`  registration open: /r/${SLUG}/lmuns-xii`)
  console.log(`  registration shut: /r/${SLUG}/${conference.slug}`)
  console.table(counts)

  await db.$disconnect()
}

await main()
