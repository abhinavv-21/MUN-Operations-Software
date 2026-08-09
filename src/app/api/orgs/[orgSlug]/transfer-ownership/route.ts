import { z } from 'zod'
import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { transferOwnership } from '@/server/services/members.ts'

type Params = { orgSlug: string }

const schema = z.object({ userId: z.uuid() })

/**
 * Its own endpoint rather than a role change, because "promote them, demote me"
 * has a window with two owners and, if the second step fails, a window with
 * none.
 */
export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const { userId } = await parseJsonBody(request, schema)
    await transferOwnership(ctx, userId)
    return json({ transferred: true })
  },
  { orgParam: 'orgSlug', audit: 'organization.transfer_ownership' },
)
