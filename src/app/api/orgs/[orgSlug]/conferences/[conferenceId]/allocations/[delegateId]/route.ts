import { json, withApi } from '@/server/api.ts'
import { unallocate } from '@/server/services/allocations.ts'

type Params = { orgSlug: string; conferenceId: string; delegateId: string }

export const DELETE = withApi<Params>(
  async ({ params, ctx }) => {
    await unallocate(ctx, params.delegateId)
    return json({ removed: true })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'assignment.remove' },
)
