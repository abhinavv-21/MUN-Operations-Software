import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { PermissionDenied } from '@/components/ui/States.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { AuditClient } from '@/components/audit/AuditClient.tsx'

export const metadata: Metadata = { title: 'Audit log' }

type Params = { orgSlug: string; conferenceId: string }

/**
 * Conference-scoped, and admin only.
 *
 * Organisation-level actions — inviting a member, transferring ownership —
 * carry a null `conferenceId` and are deliberately not here. They belong on the
 * organisation settings screen in Stage 8, alongside the people who can act on
 * them.
 */
export default async function AuditPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })

  if (ctx.conferenceRole !== 'ADMIN') {
    return <PermissionDenied what="The audit log" />
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made in this conference, who made it and what it looked like before."
      />
      <AuditClient
        endpoint={`/api/orgs/${orgSlug}/conferences/${conferenceId}/audit`}
        queryScope={conferenceId}
      />
    </>
  )
}
