import type { Metadata } from 'next'
import { pageCtx } from '@/server/page-ctx.ts'
import { requireOrg } from '@/server/ctx.ts'
import { requireMemberManager } from '@/server/auth/membership.ts'
import { listMembers } from '@/server/services/members.ts'
import { listInvitations } from '@/server/services/invitations.ts'
import { MembersClient } from './MembersClient.tsx'

export const metadata: Metadata = { title: 'Members' }

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  // The same gate the API applies, run here too — because this is the render
  // that would otherwise leak the list before any API call happened.
  requireMemberManager(membership)

  const [members, invitations] = await Promise.all([listMembers(ctx), listInvitations(ctx)])

  return (
    <main className="page">
      <header className="page-header">
        <h1>Members</h1>
      </header>
      <MembersClient
        orgSlug={orgSlug}
        currentUserId={ctx.user?.id ?? ''}
        currentUserRole={membership.orgRole}
        initialMembers={members.map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() }))}
        initialInvitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          orgRole: invitation.orgRole,
          acceptedAt: invitation.acceptedAt ? invitation.acceptedAt.toISOString() : null,
          expiresAt: invitation.expiresAt.toISOString(),
        }))}
      />
    </main>
  )
}
