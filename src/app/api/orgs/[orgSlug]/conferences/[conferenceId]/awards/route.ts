import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { createAward, createAwardSchema, listAwards } from '@/server/services/awards.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(async ({ ctx }) => json({ awards: await listAwards(ctx) }), {
  orgParam: 'orgSlug',
  conferenceParam: 'conferenceId',
})

export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, createAwardSchema)
    return json({ award: await createAward(ctx, input) }, 201)
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'award.create' },
)
