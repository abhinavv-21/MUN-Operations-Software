import { afterAll, beforeEach, expect, it } from 'vitest'
import { unsafeDb } from '../src/server/db.ts'
import {
  checkReviewTransition,
  generateReference,
  isHoneypotTripped,
  referencePattern,
  referencePrefix,
} from '../src/server/registrations.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'
import { describe } from 'vitest'

const req = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const APPLICANT = {
  fullName: 'Priya Sharma',
  email: 'priya@school.test',
  phone: '9999999999',
  schoolName: 'Lucknow Public School',
  committeePreference: 'UNSC',
}

async function seedOpenConference() {
  const org = await unsafeDb.organization.create({
    data: { slug: 'zz-lps', name: 'Lucknow Public School Model UN' },
  })
  const conference = await unsafeDb.conference.create({
    data: { organizationId: org.id, slug: 'mun-xi', name: 'LRI MUN XI', status: 'OPEN' },
  })
  return { org, conference }
}

async function submit(body: unknown, ip = '203.0.113.10') {
  const { POST } = await import(
    '../src/app/api/public/[orgSlug]/[conferenceSlug]/register/route.ts'
  )
  return POST(req('/api/public/zz-lps/mun-xi/register', body, { 'x-vercel-forwarded-for': ip }), {
    ...params({ orgSlug: 'zz-lps', conferenceSlug: 'mun-xi' }),
  })
}

/** Pure logic: no database, no network. */
describe('registration references and the honeypot', () => {
it('builds a reference from the conference slug', () => {
  // The reference product hardcodes LMX-, because it serves one conference.
  // Here a delegate may hold references from two editions at once.
  expect(referencePrefix('mun-xi')).toBe('MUNXI-')
  expect(referencePattern('mun-xi').test(generateReference('mun-xi'))).toBe(true)
})

it('leaves the characters people misread out of the random part', () => {
  // A reference gets read down a phone and copied off a screenshot, so
  // "was that an O or a zero" is a real support cost.
  //
  // The prefix is exempt and has to be: it comes from the conference slug, and
  // `mun-xi` legitimately contains an I. A fixed prefix is read as a word, not
  // dictated character by character — it is the random tail that has to be
  // unambiguous.
  const random = Array.from({ length: 200 }, () =>
    generateReference('mun-xi').split('-')[1],
  ).join('')

  expect(random).not.toMatch(/[01OI]/)
  expect(random.length).toBe(200 * 6)
})

it('treats anything but an absent or empty string as a tripped honeypot', () => {
  expect(isHoneypotTripped(undefined)).toBe(false)
  expect(isHoneypotTripped(null)).toBe(false)
  expect(isHoneypotTripped('')).toBe(false)
  expect(isHoneypotTripped('   ')).toBe(false)
  expect(isHoneypotTripped('http://spam')).toBe(true)
  // A number or an object would otherwise fall through to a 422 naming the field.
  expect(isHoneypotTripped(42)).toBe(true)
  expect(isHoneypotTripped({})).toBe(true)
})

it('only allows a decision on a pending registration', () => {
  expect(checkReviewTransition('PENDING', 'approve').allowed).toBe(true)
  expect(checkReviewTransition('APPROVED', 'approve').allowed).toBe(false)
  expect(checkReviewTransition('APPROVED', 'reject').reason).toContain('Delete the delegate')
  expect(checkReviewTransition('REJECTED', 'approve').reason).toContain('submit a new one')
})
})

describeWithDb('the public registration endpoint', () => {
  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.registration.deleteMany({})
    await unsafeDb.delegate.deleteMany({})
  })

  afterAll(async () => {
    await resetDatabase()
  })

  it('answers a repeat submission identically, with one row behind it', async () => {
    await seedOpenConference()

    const first = await submit(APPLICANT)
    const second = await submit(APPLICANT)
    const firstBody = await first.json()
    const secondBody = await second.json()

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(firstBody.status).toBe('received')
    expect(secondBody.status).toBe('received')

    // Same reference, because it is the same live application. What matters is
    // that the two responses are the same shape: a distinguishable answer would
    // turn this endpoint into an oracle for "has this person applied?" against
    // any email address someone cared to try.
    expect(Object.keys(secondBody).sort()).toEqual(['reference', 'status'])
    expect(await unsafeDb.registration.count()).toBe(1)
  })

  it('accepts a filled honeypot and writes nothing', async () => {
    await seedOpenConference()

    const response = await submit({ ...APPLICANT, hp_website: 'http://spam.example' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.status).toBe('received')
    // A well-formed reference that matches nothing. A bot that gets an error
    // learns to fix its submission; one that gets this learns nothing.
    expect(referencePattern('mun-xi').test(body.reference)).toBe(true)
    expect(await unsafeDb.registration.count()).toBe(0)
  })

  it('runs the honeypot before validation, so a bot never sees a 422', async () => {
    await seedOpenConference()

    // Missing every required field, and the trap filled.
    const response = await submit({ hp_website: 'x' })

    expect(response.status).toBe(201)
    expect(await unsafeDb.registration.count()).toBe(0)
  })

  it('stores the address the platform vouched for, not the one claimed', async () => {
    await seedOpenConference()

    const { POST } = await import(
      '../src/app/api/public/[orgSlug]/[conferenceSlug]/register/route.ts'
    )
    await POST(
      req('/api/public/zz-lps/mun-xi/register', APPLICANT, {
        // Caller-supplied and therefore worthless as an audit or limit key.
        'x-forwarded-for': '1.2.3.4',
        'x-vercel-forwarded-for': '203.0.113.99',
      }),
      params({ orgSlug: 'zz-lps', conferenceSlug: 'mun-xi' }),
    )

    const row = await unsafeDb.registration.findFirstOrThrow()
    expect(row.submittedIp).toBe('203.0.113.99')
  })

  it('records a committee preference and allocates nothing', async () => {
    await seedOpenConference()
    await submit(APPLICANT)

    const row = await unsafeDb.registration.findFirstOrThrow()

    // A form answer is a wish; an allocation is a decision the secretariat
    // makes. Silently honouring a stated preference is the worst kind of
    // helpful.
    expect(row.committeePreference).toBe('UNSC')
    expect(await unsafeDb.delegate.count()).toBe(0)
  })

  it('is not addressable while the conference is a draft', async () => {
    const org = await unsafeDb.organization.create({
      data: { slug: 'zz-lps', name: 'Lucknow Public School Model UN' },
    })
    await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-xi', name: 'LRI MUN XI', status: 'DRAFT' },
    })

    // A conference being drafted should not be discoverable by guessing a slug.
    expect((await submit(APPLICANT)).status).toBe(404)
  })

  it('refuses once the deadline has passed', async () => {
    const org = await unsafeDb.organization.create({
      data: { slug: 'zz-lps', name: 'Lucknow Public School Model UN' },
    })
    await unsafeDb.conference.create({
      data: {
        organizationId: org.id,
        slug: 'mun-xi',
        name: 'LRI MUN XI',
        status: 'OPEN',
        registrationDeadline: new Date('2020-01-01T00:00:00.000Z'),
      },
    })

    const response = await submit(APPLICANT)

    expect(response.status).toBe(409)
    expect(await unsafeDb.registration.count()).toBe(0)
  })

  it('keeps two conferences\' applications apart', async () => {
    const { org } = await seedOpenConference()
    const second = await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-x', name: 'LRI MUN X', status: 'OPEN' },
    })

    await submit(APPLICANT)

    const { POST } = await import(
      '../src/app/api/public/[orgSlug]/[conferenceSlug]/register/route.ts'
    )
    // The same student registering for two editions has to work. The reference
    // product's globally unique delegate email makes this impossible.
    const other = await POST(
      req('/api/public/zz-lps/mun-x/register', APPLICANT, {
        'x-vercel-forwarded-for': '203.0.113.11',
      }),
      params({ orgSlug: 'zz-lps', conferenceSlug: 'mun-x' }),
    )

    expect(other.status).toBe(201)
    expect(await unsafeDb.registration.count()).toBe(2)
    expect(await unsafeDb.registration.count({ where: { conferenceId: second.id } })).toBe(1)
  })
})

describeWithDb('payment proof pinning', () => {
  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.registration.deleteMany({})
  })

  afterAll(async () => {
    await resetDatabase()
  })

  it('drops a payment proof URL that is not ours', async () => {
    await seedOpenConference()

    await submit({
      ...APPLICANT,
      // A URL an organiser would later click from the review queue. Storing it
      // would make this form a phishing delivery mechanism.
      paymentProofUrl: 'https://evil.example/mun-ops/payment-proofs/receipt.png',
    })

    const row = await unsafeDb.registration.findFirstOrThrow()
    expect(row.paymentProofUrl).toBeNull()
  })

  it('drops a URL on our host but outside the prefix', async () => {
    await seedOpenConference()
    const endpoint = process.env.S3_ENDPOINT
    const bucket = process.env.S3_BUCKET
    if (!endpoint || !bucket) return

    await submit({
      ...APPLICANT,
      paymentProofUrl: `${endpoint}/${bucket}/somewhere-else/receipt.png`,
    })

    const row = await unsafeDb.registration.findFirstOrThrow()
    expect(row.paymentProofUrl).toBeNull()
  })

  it('keeps a URL that is genuinely ours', async () => {
    await seedOpenConference()
    const endpoint = process.env.S3_ENDPOINT
    const bucket = process.env.S3_BUCKET
    if (!endpoint || !bucket) return

    const ours = `${endpoint}/${bucket}/payment-proofs/zz-conf/abc123.png`
    await submit({ ...APPLICANT, paymentProofUrl: ours })

    const row = await unsafeDb.registration.findFirstOrThrow()
    expect(row.paymentProofUrl).toBe(ours)
  })
})
