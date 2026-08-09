import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { getConference } from '@/server/services/conferences.ts'
import { RegistrationsClient } from './RegistrationsClient.tsx'

export const metadata: Metadata = { title: 'Registrations' }

type Params = { orgSlug: string; conferenceId: string }

export default async function RegistrationsPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  const conference = await getConference(ctx, conferenceId)

  const publicUrl = `/r/${orgSlug}/${conference.slug}`

  return (
    <>
      <PageHeader
        title="Registrations"
        description={
          conference.status === 'OPEN'
            ? `Applications arrive from ${publicUrl}, from a connected form, or from a spreadsheet.`
            : 'This conference is not currently accepting public applications.'
        }
      />
      <RegistrationsClient
        orgSlug={orgSlug}
        conferenceId={conferenceId}
        canReview={ctx.conferenceRole === 'ADMIN'}
      />
    </>
  )
}
