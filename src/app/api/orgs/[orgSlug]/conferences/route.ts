import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  createConference,
  createConferenceSchema,
  listConferences,
} from '@/server/services/conferences.ts'

type Params = { orgSlug: string }

export const GET = withApi<Params>(
  async ({ ctx }) => json({ conferences: await listConferences(ctx) }),
  { orgParam: 'orgSlug' },
)

export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, createConferenceSchema)
    return json({ conference: await createConference(ctx, input) }, 201)
  },
  { orgParam: 'orgSlug', audit: 'conference.create' },
)
