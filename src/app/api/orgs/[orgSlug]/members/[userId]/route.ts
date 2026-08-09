import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { removeMember, updateMember, updateMemberSchema } from '@/server/services/members.ts'

type Params = { orgSlug: string; userId: string }

export const PATCH = withApi<Params>(
  async ({ request, params, ctx }) => {
    const input = await parseJsonBody(request, updateMemberSchema)
    return json({ member: await updateMember(ctx, params.userId, input) })
  },
  { orgParam: 'orgSlug', audit: 'membership.update' },
)

export const DELETE = withApi<Params>(
  async ({ params, ctx }) => {
    await removeMember(ctx, params.userId)
    return json({ removed: true })
  },
  { orgParam: 'orgSlug', audit: 'membership.remove' },
)
