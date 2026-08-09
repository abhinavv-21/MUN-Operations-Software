import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { pageCtx } from '@/server/page-ctx.ts'
import { isOrgAdmin } from '@/server/auth/membership.ts'
import { listConferences } from '@/server/services/conferences.ts'
import { ConferencesClient } from './ConferencesClient.tsx'

export const metadata: Metadata = { title: 'Conferences' }

export default async function ConferencesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  // Fetched on the server so the first paint has the list, then handed to
  // TanStack Query as initialData. No spinner for data we already had.
  const conferences = await listConferences(ctx)

  return (
    <>
      <PageHeader
        title="Conferences"
        description="Each conference keeps its own committees, delegates, allocations and branding."
      />
      <ConferencesClient
        orgSlug={orgSlug}
        canCreate={isOrgAdmin(membership.orgRole)}
        initialConferences={conferences.map((conference) => ({
          ...conference,
          startsOn: conference.startsOn ? conference.startsOn.toISOString() : null,
          endsOn: conference.endsOn ? conference.endsOn.toISOString() : null,
        }))}
      />
    </>
  )
}
