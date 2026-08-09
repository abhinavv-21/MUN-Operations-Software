import { z } from 'zod'
import { json, withApi } from '@/server/api.ts'
import { clientAddress } from '@/server/ctx.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { enforceRateLimit, UPLOAD_BURST } from '@/server/rate-limit.ts'
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, presignPut, storageEnabled } from '@/server/storage.ts'
import { loadPublicConference, registrationWindow } from '@/server/services/public-registration.ts'
import { ApiError } from '@/server/errors.ts'

type Params = { orgSlug: string; conferenceSlug: string }

const schema = z.object({
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  contentLength: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

/**
 * Hands out a presigned PUT for a payment screenshot.
 *
 * Its own rate-limit budget, because asking for an upload URL is not a
 * submission. Ten in a quarter of an hour sits above the five submissions the
 * same window allows — one screenshot per application, plus room to retry a
 * photo that came out unreadable. Any higher and this is free anonymous file
 * hosting on the organiser's bucket, which is the only thing standing between
 * this endpoint and someone filling it: a presigned PUT cannot cap its own
 * body size.
 */
export const POST = withApi<Params>(
  async ({ request, params }) => {
    const conference = await loadPublicConference(params.orgSlug, params.conferenceSlug)

    if (!storageEnabled()) {
      throw ApiError.serviceUnavailable(
        'Uploads are not available for this conference. Submit without a payment screenshot.',
      )
    }

    if (!registrationWindow(conference).open) {
      throw ApiError.conflict('This conference is not accepting registrations.')
    }

    await enforceRateLimit(`upload:${conference.id}`, clientAddress(request) ?? 'unknown', [
      UPLOAD_BURST,
    ])

    const { contentType, contentLength } = await parseJsonBody(request, schema)

    return json(await presignPut(conference.id, contentType, contentLength))
  },
  { auth: 'none' },
)
