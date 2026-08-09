import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
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
