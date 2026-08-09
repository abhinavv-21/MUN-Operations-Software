import { json, withApi } from '@/server/api.ts'
import { approveRegistration } from '@/server/services/review.ts'

type Params = { orgSlug: string; conferenceId: string; registrationId: string }

/** Creates a delegate. Allocates nothing — see the service for why. */
export const POST = withApi<Params>(
  async ({ params, ctx }) =>
    json({ delegate: await approveRegistration(ctx, params.registrationId) }, 201),
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'registration.approve' },
)
