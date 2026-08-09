import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  deleteConference,
  deleteConferenceSchema,
  getConference,
  updateConference,
  updateConferenceSchema,
} from '@/server/services/conferences.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ params, ctx }) => json({ conference: await getConference(ctx, params.conferenceId) }),
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)

export const PATCH = withApi<Params>(
  async ({ request, params, ctx }) => {
    const input = await parseJsonBody(request, updateConferenceSchema)
    return json({ conference: await updateConference(ctx, params.conferenceId, input) })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'conference.update' },
)

/**
 * The most destructive call in the product.
 *
 * The typed confirmation is verified in the service, not here, so a `curl` that
 * skips the dialog does not skip the confirmation. Everything conference-scoped
 * goes by cascade; the audit trail does not, because `AuditLog.conferenceId` is
 * `SetNull` — see `deleteConference`.
 */
export const DELETE = withApi<Params>(
  async ({ request, params, ctx }) => {
    const input = await parseJsonBody(request, deleteConferenceSchema)
    return json(await deleteConference(ctx, params.conferenceId, input))
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'conference.delete' },
)
