import { json, withApi } from '@/server/api.ts'
import { clientAddress } from '@/server/ctx.ts'
import { parseOrThrow } from '@/server/validate.ts'
import { enforceRateLimit, SUBMISSION_BURST, SUBMISSION_SUSTAINED } from '@/server/rate-limit.ts'
import {
  honeypotResponse,
  honeypotTripped,
  loadPublicConference,
  publicRegistrationSchema,
  registrationWindow,
  submitRegistration,
  type RegistrationAccepted,
} from '@/server/services/public-registration.ts'

type Params = { orgSlug: string; conferenceSlug: string }

/**
 * The only unauthenticated write in the product.
 *
 * `auth: 'none'` — there is no session to read and no cookie store to reach
 * for. Everything this route needs comes from the path and the body.
 *
 * The order of operations is the security design, not an accident:
 *   1. resolve the conference (404 if it is not publicly addressable)
 *   2. rate limit, keyed on the address the platform vouched for
 *   3. the honeypot, before validation, so a bot never sees a field-level 422
 *   4. validate
 *   5. create or find, in one serializable transaction
 */
export const POST = withApi<Params>(
  async ({ request, params }) => {
    const conference = await loadPublicConference(params.orgSlug, params.conferenceSlug)

    const address = clientAddress(request) ?? 'unknown'
    await enforceRateLimit(`register:${conference.id}`, address, [
      SUBMISSION_BURST,
      SUBMISSION_SUSTAINED,
    ])

    const raw: unknown = await request.json().catch(() => ({}))

    if (honeypotTripped(raw)) {
      // 201 with a fabricated reference. A bot that gets an error learns to fix
      // its submission; one that gets a plausible reference learns nothing.
      return json(await honeypotResponse(conference.slug), 201)
    }

    const window = registrationWindow(conference)
    if (!window.open) {
      return json(
        {
          error:
            window.reason === 'deadline'
              ? 'Registration for this conference has closed.'
              : 'This conference is not accepting registrations.',
          code: 409,
        },
        409,
      )
    }

    const input = parseOrThrow(publicRegistrationSchema, raw)

    const outcome = await submitRegistration(
      { id: conference.id, slug: conference.slug, organizationId: conference.organization.id },
      input,
      {
        submittedIp: address === 'unknown' ? null : address,
        userAgent: request.headers.get('user-agent'),
      },
    )

    // Created and duplicate are indistinguishable from outside. If they were
    // not, this endpoint would answer "has this person registered?" against any
    // email address someone cared to try. `outcome.created` exists only so the
    // server can tell them apart; nothing about it reaches the response.
    const accepted: RegistrationAccepted = { status: 'received', reference: outcome.reference }

    return json(accepted, 201)
  },
  { auth: 'none' },
)
