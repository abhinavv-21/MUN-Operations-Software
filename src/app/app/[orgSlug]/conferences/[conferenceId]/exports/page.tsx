import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { PermissionDenied } from '@/components/ui/States.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { DATASETS } from '@/server/services/exports.ts'
import { ExportsClient } from './ExportsClient.tsx'

export const metadata: Metadata = { title: 'Exports' }

type Params = { orgSlug: string; conferenceId: string }

export default async function ExportsPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })

  if (ctx.conferenceRole !== 'ADMIN') {
    return <PermissionDenied what="Exporting conference data" />
  }

  return (
    <>
      <PageHeader
        title="Exports"
        description="Three formats, one dataset each. CSV and Excel carry every character; the PDF is for printing."
      />
      <ExportsClient orgSlug={orgSlug} conferenceId={conferenceId} datasets={DATASETS} />
    </>
  )
}
