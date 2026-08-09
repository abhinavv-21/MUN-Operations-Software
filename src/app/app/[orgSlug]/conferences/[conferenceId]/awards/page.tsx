import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { PermissionDenied } from '@/components/ui/States.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { listCommittees } from '@/server/services/committees.ts'
import { SUGGESTED_AWARDS } from '@/server/services/awards.ts'
import { AwardsClient } from './AwardsClient.tsx'

export const metadata: Metadata = { title: 'Awards' }

type Params = { orgSlug: string; conferenceId: string }

/**
 * The role check is here as well as in the service.
 *
 * Invariant 3: a Server Component calls services directly, so a check that
 * lived only in the route handler would not run for the first paint. This one
 * decides what to render; `requireConferenceAdmin` inside `createAward` is what
 * actually refuses the write.
 */
export default async function AwardsPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })

  if (ctx.conferenceRole !== 'ADMIN') {
    return <PermissionDenied what="Awards" />
  }

  const committees = await listCommittees(ctx)

  return (
    <>
      <PageHeader
        title="Awards"
        description="Grouped by committee, in the order they are read out."
      />
      <AwardsClient
        orgSlug={orgSlug}
        conferenceId={conferenceId}
        committees={committees.map((committee) => ({
          id: committee.id,
          code: committee.code,
          name: committee.name,
        }))}
        suggestions={SUGGESTED_AWARDS}
      />
    </>
  )
}
