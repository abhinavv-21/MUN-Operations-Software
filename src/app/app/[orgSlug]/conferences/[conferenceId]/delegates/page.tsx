import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { DelegatesClient } from './DelegatesClient.tsx'

export const metadata: Metadata = { title: 'Delegates' }

type Params = { orgSlug: string; conferenceId: string }

export default async function DelegatesPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })

  return (
    <>
      <PageHeader
        title="Delegates and allocations"
        description="Approving an application creates a delegate. Placing them is a separate decision, made here."
      />
      <DelegatesClient
        orgSlug={orgSlug}
        conferenceId={conferenceId}
        canEdit={ctx.conferenceRole === 'ADMIN'}
      />
    </>
  )
}
