import { z } from 'zod'
import { json, withApi } from '@/server/api.ts'
import { parseJsonBody, parseSearchParams } from '@/server/validate.ts'
import { acceptInvitation, previewInvitation } from '@/server/services/invitations.ts'

const tokenSchema = z.object({ token: z.string().min(32).max(128) })

/**
 * No `orgParam`: the organisation is discovered by looking the token up, which
 * is the point of the token. `ctx` therefore carries no organisation, and both
 * services build their own scoped client once they know which one it is.
 */
export const GET = withApi(async ({ request, ctx }) => {
  const { token } = parseSearchParams(new URL(request.url), tokenSchema)
  return json({ invitation: await previewInvitation(token, ctx.user?.email ?? null) })
}, { auth: 'optional' })

export const POST = withApi(
  async ({ request, ctx }) => {
    const { token } = await parseJsonBody(request, tokenSchema)
    return json(await acceptInvitation(ctx, token))
  },
  { audit: 'invitation.accept' },
)
