import { json, withApi } from '@/server/api.ts'
import { revokeInvitation } from '@/server/services/invitations.ts'

type Params = { orgSlug: string; invitationId: string }

export const DELETE = withApi<Params>(
  async ({ params, ctx }) => {
    await revokeInvitation(ctx, params.invitationId)
    return json({ revoked: true })
  },
  { orgParam: 'orgSlug', audit: 'invitation.revoke' },
)
