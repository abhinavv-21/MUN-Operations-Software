import { json, withApi } from '@/server/api.ts'
import { availableCountries } from '@/server/services/delegates.ts'

type Params = { orgSlug: string; conferenceId: string; committeeId: string }

/** What is still free in one committee, for the allocation control. */
export const GET = withApi<Params>(
  async ({ params, ctx }) => json({ countries: await availableCountries(ctx, params.committeeId) }),
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)
