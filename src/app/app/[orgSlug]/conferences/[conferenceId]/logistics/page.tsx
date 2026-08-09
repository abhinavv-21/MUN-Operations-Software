import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { listCommittees } from '@/server/services/committees.ts'
import { LogisticsClient } from './LogisticsClient.tsx'

export const metadata: Metadata = { title: 'Logistics' }

type Params = { orgSlug: string; conferenceId: string }

export default async function LogisticsPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  const committees = await listCommittees(ctx)

  return (
    <>
      <PageHeader
        title="Logistics"
        description="Raising a request works without a connection. Resolving one does not, on purpose."
      />
      <LogisticsClient
        orgSlug={orgSlug}
        conferenceId={conferenceId}
        committees={committees.map((committee) => ({
          id: committee.id,
          code: committee.code,
          name: committee.name,
        }))}
        canResolve
      />
    </>
  )
}
