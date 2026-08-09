import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { rejectRegistration, rejectSchema } from '@/server/services/review.ts'

type Params = { orgSlug: string; conferenceId: string; registrationId: string }

export const POST = withApi<Params>(
  async ({ request, params, ctx }) => {
    const { reason } = await parseJsonBody(request, rejectSchema)
    return json({ registration: await rejectRegistration(ctx, params.registrationId, reason) })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'registration.reject' },
)
