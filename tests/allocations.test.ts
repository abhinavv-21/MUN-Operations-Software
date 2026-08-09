import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { parseMatrix } from '../src/server/matrix.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = { sub: 'zz_auth_alice', email: 'alice@example.test' }

const post = (url: string, body: unknown) =>
  new Request(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

describe('parsing a country matrix', () => {
  it('reads a wide matrix, one column per committee', () => {
    const result = parseMatrix('UNSC,WHO\nFrance,Japan\nBrazil x2,Kenya', ['UNSC', 'WHO'])

    expect(result.shape).toBe('wide')
    expect(result.entries).toContainEqual({ committeeCode: 'UNSC', country: 'France', seats: 1 })
    expect(result.entries).toContainEqual({ committeeCode: 'UNSC', country: 'Brazil', seats: 2 })
    expect(result.entries).toHaveLength(4)
  })

  it('reads a long matrix, one row per seat', () => {
    const result = parseMatrix(
      'Committee,Country,Seats\nUNSC,France,1\nWHO,Japan,2',
      ['UNSC', 'WHO'],
    )

    expect(result.shape).toBe('long')
    expect(result.entries).toContainEqual({ committeeCode: 'WHO', country: 'Japan', seats: 2 })
  })

  it('reports an unknown committee column and creates nothing', () => {
    // The exit criterion. A typo in a header would otherwise become a committee
    // nobody meant to run, discovered when a delegate is allocated into it.
    const result = parseMatrix('UNSC,UNSCC\nFrance,Japan', ['UNSC'])

    expect(result.unknownCommittees).toEqual(['UNSCC'])
    expect(result.entries.every((entry) => entry.committeeCode === 'UNSC')).toBe(true)
    expect(result.skipped[0]!.reason).toContain('no committee was created')
  })

  it('matches committee codes case-insensitively', () => {
    expect(parseMatrix('unsc\nFrance', ['UNSC']).entries[0]!.committeeCode).toBe('UNSC')
  })

  it('reads a double delegation in either notation', () => {
    const result = parseMatrix('UNSC\nBrazil x2\nIndia (3)', ['UNSC'])
    expect(result.entries).toContainEqual({ committeeCode: 'UNSC', country: 'Brazil', seats: 2 })
    expect(result.entries).toContainEqual({ committeeCode: 'UNSC', country: 'India', seats: 3 })
  })
})

describeWithDb('allocation', () => {
  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.assignment.deleteMany({})
    await unsafeDb.delegate.deleteMany({})
    signedIn = null
  })

  afterAll(async () => {
    await resetDatabase()
  })

  async function seed(options: { seats?: number | null; matrix?: string[] } = {}) {
    const { POST } = await import('../src/app/api/orgs/route.ts')
    signedIn = ALICE
    await POST(post('/api/orgs', { name: 'Alpha MUN Society', slug: 'zz-alpha' }), undefined)

    const org = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-alpha' } })
    const conference = await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-xi', name: 'MUN XI', status: 'OPEN' },
    })
    const committee = await unsafeDb.committee.create({
      data: {
        conferenceId: conference.id,
        code: 'UNSC',
        name: 'Security Council',
        seats: options.seats === undefined ? null : options.seats,
      },
    })

    if (options.matrix) {
      await unsafeDb.committeeCountry.createMany({
        data: options.matrix.map((country) => ({
          conferenceId: conference.id,
          committeeId: committee.id,
          country,
        })),
      })
    }

    const delegates = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        unsafeDb.delegate.create({
          data: {
            conferenceId: conference.id,
            fullName: `Delegate ${index}`,
            email: `delegate${index}@school.test`,
          },
        }),
      ),
    )

    return { conference, committee, delegates }
  }

  async function allocate(conferenceId: string, body: unknown) {
    const { POST } = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/allocations/route.ts'
    )
    return POST(
      post(`/api/orgs/zz-alpha/conferences/${conferenceId}/allocations`, body),
      params({ orgSlug: 'zz-alpha', conferenceId }),
    )
  }

  it('gives one country to exactly one delegate under concurrency', async () => {
    const { conference, committee, delegates } = await seed()

    // The reason this whole stage exists. Eight organisers, one country, at the
    // same instant.
    const responses = await Promise.all(
      delegates.map((delegate) =>
        allocate(conference.id, {
          delegateId: delegate.id,
          committeeId: committee.id,
          country: 'France',
        }),
      ),
    )

    const statuses = responses.map((response) => response.status)
    const created = statuses.filter((status) => status === 201)
    const conflicts = statuses.filter((status) => status === 409)

    expect(created).toHaveLength(1)
    expect(conflicts).toHaveLength(delegates.length - 1)
    // Never two rows. The unique constraint is the guarantee; the serializable
    // transaction is what turned the race into a clean 409 instead of a crash.
    expect(
      await unsafeDb.assignment.count({ where: { committeeId: committee.id, country: 'France' } }),
    ).toBe(1)
    // And nothing answered 500.
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true)
  })

  it('never oversubscribes a committee under concurrency', async () => {
    // Three seats, eight organisers, eight different countries.
    const { conference, committee, delegates } = await seed({ seats: 3 })
    const countries = ['France', 'Japan', 'Brazil', 'Kenya', 'Peru', 'Chad', 'Fiji', 'Oman']

    const responses = await Promise.all(
      delegates.map((delegate, index) =>
        allocate(conference.id, {
          delegateId: delegate.id,
          committeeId: committee.id,
          country: countries[index],
        }),
      ),
    )

    const created = responses.filter((response) => response.status === 201)

    // Capacity is a read-then-write. Without the serializable transaction every
    // one of these reads "0 of 3 filled" and every one of them writes.
    expect(created.length).toBeLessThanOrEqual(3)
    expect(await unsafeDb.assignment.count({ where: { committeeId: committee.id } })).toBe(
      created.length,
    )
    expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true)
  })

  it('accepts any country when the committee has no matrix', async () => {
    const { conference, committee, delegates } = await seed()

    // Zero rows is a supported state, not a missing one: it is what lets one
    // committee's matrix be imported without freezing the other five.
    const response = await allocate(conference.id, {
      delegateId: delegates[0]!.id,
      committeeId: committee.id,
      country: 'Somewhere Not On Any List',
    })

    expect(response.status).toBe(201)
  })

  it('refuses a country outside the matrix once one exists', async () => {
    const { conference, committee, delegates } = await seed({ matrix: ['France', 'Japan'] })

    const ok = await allocate(conference.id, {
      delegateId: delegates[0]!.id,
      committeeId: committee.id,
      country: 'france',
    })
    expect(ok.status).toBe(201)

    const refused = await allocate(conference.id, {
      delegateId: delegates[1]!.id,
      committeeId: committee.id,
      country: 'Atlantis',
    })
    const body = await refused.json()

    expect(refused.status).toBe(422)
    expect(JSON.stringify(body.details)).toContain('country matrix')
  })

  it('moves a delegate rather than giving them a second seat', async () => {
    const { conference, committee, delegates } = await seed()
    const second = await unsafeDb.committee.create({
      data: { conferenceId: conference.id, code: 'WHO', name: 'World Health Organization' },
    })

    await allocate(conference.id, {
      delegateId: delegates[0]!.id,
      committeeId: committee.id,
      country: 'France',
    })
    const moved = await allocate(conference.id, {
      delegateId: delegates[0]!.id,
      committeeId: second.id,
      country: 'Japan',
    })

    expect(moved.status).toBe(201)
    // Someone in two committees at once is in neither of them.
    expect(await unsafeDb.assignment.count({ where: { delegateId: delegates[0]!.id } })).toBe(1)
    expect(await unsafeDb.assignment.count()).toBe(1)
  })

  it('answers 404 for a delegate from another conference', async () => {
    const { conference, committee } = await seed()
    const org = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-alpha' } })
    const other = await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-x', name: 'MUN X' },
    })
    const outsider = await unsafeDb.delegate.create({
      data: { conferenceId: other.id, fullName: 'Outsider', email: 'outsider@school.test' },
    })

    const response = await allocate(conference.id, {
      delegateId: outsider.id,
      committeeId: committee.id,
      country: 'France',
    })

    expect(response.status).toBe(404)
    expect(await unsafeDb.assignment.count()).toBe(0)
  })

  it('imports a matrix without creating a committee it does not know', async () => {
    const { conference } = await seed()

    const { POST } = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/matrix/import/route.ts'
    )
    const response = await POST(
      post(`/api/orgs/zz-alpha/conferences/${conference.id}/matrix/import`, {
        csv: 'UNSC,DISEC\nFrance,Japan\nBrazil,Kenya',
        mode: 'replace',
      }),
      params({ orgSlug: 'zz-alpha', conferenceId: conference.id }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.unknownCommittees).toEqual(['DISEC'])
    expect(body.created).toBe(2)
    // The whole point: no committee was invented.
    expect(await unsafeDb.committee.count({ where: { conferenceId: conference.id } })).toBe(1)
    expect(await unsafeDb.committeeCountry.count()).toBe(2)
  })

  it('replaces only the committees the file names', async () => {
    const { conference, committee } = await seed({ matrix: ['France'] })
    const untouched = await unsafeDb.committee.create({
      data: { conferenceId: conference.id, code: 'WHO', name: 'World Health Organization' },
    })
    await unsafeDb.committeeCountry.create({
      data: { conferenceId: conference.id, committeeId: untouched.id, country: 'Japan' },
    })

    const { POST } = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/matrix/import/route.ts'
    )
    await POST(
      post(`/api/orgs/zz-alpha/conferences/${conference.id}/matrix/import`, {
        csv: 'UNSC\nBrazil\nKenya',
        mode: 'replace',
      }),
      params({ orgSlug: 'zz-alpha', conferenceId: conference.id }),
    )

    // A matrix covering one committee must not wipe the other five.
    expect(await unsafeDb.committeeCountry.count({ where: { committeeId: untouched.id } })).toBe(1)
    expect(await unsafeDb.committeeCountry.count({ where: { committeeId: committee.id } })).toBe(2)
  })
})

describe('serialization failures', () => {
  it('recognises a write conflict however the driver reports it', async () => {
    const { runSerializable } = await import('../src/server/transaction.ts')

    // Prisma's own engine says P2034. Through a driver adapter the same failure
    // arrives as DriverAdapterError: TransactionWriteConflict, and matching only
    // on the code turned every retryable conflict into an unhandled 500.
    const shapes = [
      Object.assign(new Error('nope'), { code: 'P2034' }),
      Object.assign(new Error('DriverAdapterError: TransactionWriteConflict'), { code: 'P2010' }),
      Object.assign(new Error('could not serialize access due to read/write dependencies'), {}),
      Object.assign(new Error('wrapped'), {
        cause: Object.assign(new Error('deadlock detected'), {}),
      }),
    ]

    for (const shape of shapes) {
      let attempts = 0
      const db = {
        $transaction: async () => {
          attempts += 1
          throw shape
        },
      } as never

      const error = await runSerializable(db, async () => 'never', 2).catch((caught) => caught)

      expect(attempts, String(shape.message)).toBe(2)
      // Exhausted retries are a conflict, not a server fault: another organiser
      // reached the same seat first. A 500 tells the operator the product is
      // broken when the right move is to look and try again.
      expect(error.code, String(shape.message)).toBe(409)
    }
  })

  it('does not retry an error it should not', async () => {
    const { runSerializable } = await import('../src/server/transaction.ts')

    let attempts = 0
    const db = {
      $transaction: async () => {
        attempts += 1
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' })
      },
    } as never

    await runSerializable(db, async () => 'never', 3).catch(() => undefined)

    // Retrying a unique-constraint violation three times just fails three times
    // more slowly.
    expect(attempts).toBe(1)
  })
})
