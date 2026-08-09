import { z } from 'zod'
import { json, withApi } from '@/server/api.ts'
import { clientAddress } from '@/server/ctx.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { enforceRateLimit, SUBMISSION_SUSTAINED } from '@/server/rate-limit.ts'
import { ingestFromSheets } from '@/server/services/ingest.ts'
import { ApiError } from '@/server/errors.ts'

type Params = { conferenceId: string }

const schema = z.object({ csv: z.string().min(1).max(2_000_000) })

/**
 * The webhook an organiser's Apps Script posts to.
 *
 * The secret is the credential and it is bound to one conference, so a working
 * script repointed at another conference's id answers 401 — that conference has
 * a different secret, and the compare is against the row named in the URL.
 *
 * Header, not query string: a secret in a URL ends up in access logs, in
 * `Referer`, and in the browser history of whoever pastes it somewhere.
 */
export const POST = withApi<Params>(
  async ({ request, params }) => {
    const secret = request.headers.get('x-webhook-secret')
    if (!secret) throw ApiError.unauthorized('Missing webhook secret')

    await enforceRateLimit(`sheets:${params.conferenceId}`, clientAddress(request) ?? 'unknown', [
      SUBMISSION_SUSTAINED,
    ])

    const { csv } = await parseJsonBody(request, schema)
    return json(await ingestFromSheets(params.conferenceId, secret, csv))
  },
  { auth: 'none' },
)
