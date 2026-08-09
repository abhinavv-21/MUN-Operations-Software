import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError } from '../src/server/errors.ts'
import { json, toApiError, withApi } from '../src/server/api.ts'
import { parseJsonBody, parseOrThrow } from '../src/server/validate.ts'
import { describeWithDb } from './support/harness.ts'

const post = (body: unknown) =>
  new Request('https://example.test/api/thing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/**
 * The error contract, tested at the wrapper rather than per route.
 *
 * Leaving Express costs the middleware-order file that made the chain readable
 * in one place. `withApi` is the replacement, so it gets the tests the chain
 * used to have — otherwise the contract is only as good as the last route
 * someone wrote by hand.
 */
describe('the error contract', () => {
  const originalExpose = process.env.EXPOSE_ERROR_DETAILS

  afterEach(() => {
    process.env.EXPOSE_ERROR_DETAILS = originalExpose
  })

  it('serialises a deliberate failure as { error, code }', async () => {
    const handler = withApi(async () => {
      throw ApiError.forbidden('Not yours')
    })

    const response = await handler(post({}), undefined)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Not yours', code: 403 })
  })

  it('omits details entirely rather than sending null', async () => {
    const body = ApiError.notFound('Gone').toBody()

    expect('details' in body).toBe(false)
    expect(JSON.stringify(body)).toBe('{"error":"Gone","code":404}')
  })

  it('answers 422 with a path and message for each invalid field', async () => {
    const schema = z.object({ email: z.email(), seats: z.number().int().min(1) })
    const handler = withApi(async ({ request }) => json(await parseJsonBody(request, schema)))

    const response = await handler(post({ email: 'nope', seats: 0 }), undefined)
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.code).toBe(422)
    expect(body.details).toEqual([
      { path: 'email', message: expect.any(String) },
      { path: 'seats', message: expect.any(String) },
    ])
  })

  it('labels a root-level validation failure "(root)"', () => {
    const error = (() => {
      try {
        parseOrThrow(z.object({ a: z.string() }), 'not an object')
        return undefined
      } catch (caught) {
        return caught as ApiError
      }
    })()

    expect(error?.code).toBe(422)
    expect((error?.details as { path: string }[])[0]?.path).toBe('(root)')
  })

  it('answers 400, not 422, for a body that is not JSON at all', async () => {
    const handler = withApi(async ({ request }) =>
      json(await parseJsonBody(request, z.object({}))),
    )

    const response = await handler(
      new Request('https://example.test/api/thing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ this is not json',
      }),
      undefined,
    )

    // Malformed syntax is a different failure from content that does not match
    // the schema, and the client renders them differently.
    expect(response.status).toBe(400)
  })

  it('translates a unique violation into a 409 without leaking the constraint', () => {
    const prismaError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['conferenceId', 'email'] },
    })

    const translated = toApiError(prismaError)

    expect(translated.code).toBe(409)
    expect(translated.message).toBe(
      'Someone with that email is already registered for this conference',
    )
  })

  it('translates a missing record into a 404', () => {
    expect(toApiError(Object.assign(new Error('nope'), { code: 'P2025' })).code).toBe(404)
  })

  it('fails closed on EXPOSE_ERROR_DETAILS', async () => {
    delete process.env.EXPOSE_ERROR_DETAILS
    const handler = withApi(async () => {
      throw new Error('the connection string is postgres://user:hunter2@host/db')
    })

    const response = await handler(post({}), undefined)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Something went wrong', code: 500 })
    expect(JSON.stringify(body)).not.toContain('hunter2')
  })

  it('attaches a stack only when EXPOSE_ERROR_DETAILS is explicitly on', async () => {
    process.env.EXPOSE_ERROR_DETAILS = 'true'
    const handler = withApi(async () => {
      throw new Error('boom')
    })

    const body = await (await handler(post({}), undefined)).json()

    expect(body.details.message).toBe('boom')
    expect(body.details.stack).toEqual(expect.any(String))
  })
})

describeWithDb('the health route', () => {
  it('answers 200 only after a real database round trip', async () => {
    const { GET } = await import('../src/app/api/health/route.ts')

    const response = await GET(new Request('https://example.test/api/health'), undefined)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.database.reachable).toBe(true)
    // An endpoint that returns a version string without querying keeps a
    // monitor green while the database is unreachable underneath it.
    expect(Date.parse(body.database.serverTime)).toBeGreaterThan(0)
  })
})
