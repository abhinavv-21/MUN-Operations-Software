import { json, withApi } from '@/server/api.ts'
import { parseSearchParams } from '@/server/validate.ts'
import { committeeCapacity, delegateFiltersSchema, listDelegates } from '@/server/services/delegates.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ request, ctx }) => {
    const filters = parseSearchParams(new URL(request.url), delegateFiltersSchema)
    const [delegates, committees] = await Promise.all([
      listDelegates(ctx, filters),
      committeeCapacity(ctx),
    ])
    return json({ delegates, committees })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)
