import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { listCommittees } from '@/server/services/committees.ts'
import { CommitteesClient } from './CommitteesClient.tsx'

export const metadata: Metadata = { title: 'Committees' }

type Params = { orgSlug: string; conferenceId: string }

export default async function CommitteesPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  const committees = await listCommittees(ctx)

  return (
    <>
      <PageHeader
        title="Committees"
        description="Seat capacity is enforced when a delegate is allocated, not when a committee is created."
      />
      <CommitteesClient
        orgSlug={orgSlug}
        conferenceId={conferenceId}
        canEdit={ctx.conferenceRole === 'ADMIN'}
        initialCommittees={committees}
      />
    </>
  )
}
