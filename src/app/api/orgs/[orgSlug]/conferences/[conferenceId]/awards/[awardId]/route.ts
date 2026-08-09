import { json, withApi } from '@/server/api.ts'
import { deleteAward } from '@/server/services/awards.ts'

type Params = { orgSlug: string; conferenceId: string; awardId: string }

export const DELETE = withApi<Params>(
  async ({ params, ctx }) => {
    await deleteAward(ctx, params.awardId)
    return json({ removed: true })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'award.remove' },
)
