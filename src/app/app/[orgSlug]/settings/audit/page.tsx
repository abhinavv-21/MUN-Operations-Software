import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { PermissionDenied } from '@/components/ui/States.tsx'
import { AuditClient } from '@/components/audit/AuditClient.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { isOrgAdmin } from '@/server/auth/membership.ts'
import { pageCtx } from '@/server/page-ctx.ts'

export const metadata: Metadata = { title: 'Organisation audit log' }

type Params = { orgSlug: string }

/**
 * The organisation-wide trail.
 *
 * The conference view answers "what happened to MUN XI"; this one answers
 * everything else — who was invited, who was removed, who renamed the
 * organisation — **and it is the only place a deleted conference's history can
 * be read**. Those rows keep their organisation and lose their conference,
 * which is what `AuditLog.conferenceId` being `SetNull` buys and why deleting a
 * conference is a supported action rather than a destructive one.
 */
export default async function OrganizationAuditPage({ params }: { params: Promise<Params> }) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  if (!isOrgAdmin(membership.orgRole)) {
    return <PermissionDenied what="The organisation audit log" />
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Everything done in this organisation, including in conferences that no longer exist."
      />
      <AuditClient
        endpoint={`/api/orgs/${orgSlug}/audit`}
        queryScope={`org:${orgSlug}`}
        showScopeFilter
      />
    </>
  )
}
