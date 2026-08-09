import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  createInvitation,
  createInvitationSchema,
  listInvitations,
} from '@/server/services/invitations.ts'

type Params = { orgSlug: string }

export const GET = withApi<Params>(
  async ({ ctx }) => json({ invitations: await listInvitations(ctx) }),
  { orgParam: 'orgSlug' },
)

export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, createInvitationSchema)
    const { invitation, token } = await createInvitation(ctx, input)

    // The token is in the response exactly once. Nothing stored can reproduce
    // it, so the UI must show or copy it now. v1 sends no email of its own —
    // the organiser forwards the link with the mail client they already use.
    return json({ invitation, token }, 201)
  },
  { orgParam: 'orgSlug', audit: 'invitation.create' },
)
