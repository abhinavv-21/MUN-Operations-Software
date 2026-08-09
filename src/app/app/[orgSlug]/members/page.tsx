import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { pageCtx } from '@/server/page-ctx.ts'
import { requireMemberManager } from '@/server/auth/membership.ts'
import { listMembers } from '@/server/services/members.ts'
import { listInvitations } from '@/server/services/invitations.ts'
import { MembersClient } from './MembersClient.tsx'

export const metadata: Metadata = { title: 'Members' }

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  // The same gate the API applies, run here too — this is the render that would
  // otherwise leak the list before any API call happened.
  requireMemberManager(membership)

  const [members, invitations] = await Promise.all([listMembers(ctx), listInvitations(ctx)])

  return (
    <>
      <PageHeader
        title="Members"
        description="Who can reach this organisation, and how much of it."
      />
      <MembersClient
        orgSlug={orgSlug}
        currentUserId={ctx.user?.id ?? ''}
        currentUserRole={membership.orgRole}
        members={members.map((member) => ({
          ...member,
          joinedAt: member.joinedAt.toISOString(),
        }))}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          orgRole: invitation.orgRole,
          acceptedAt: invitation.acceptedAt ? invitation.acceptedAt.toISOString() : null,
          expiresAt: invitation.expiresAt.toISOString(),
        }))}
      />
    </>
  )
}
