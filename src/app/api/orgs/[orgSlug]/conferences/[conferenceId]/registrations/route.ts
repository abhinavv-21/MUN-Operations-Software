import { json, withApi } from '@/server/api.ts'
import { parseSearchParams } from '@/server/validate.ts'
import {
  listRegistrations,
  registrationStats,
  reviewFiltersSchema,
} from '@/server/services/review.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ request, ctx }) => {
    const filters = parseSearchParams(new URL(request.url), reviewFiltersSchema)
    const [registrations, stats] = await Promise.all([
      listRegistrations(ctx, filters),
      registrationStats(ctx),
    ])
    return json({ registrations, stats })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)
