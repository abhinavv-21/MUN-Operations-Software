import Link from 'next/link'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { getConference } from '@/server/services/conferences.ts'
import { listCommittees } from '@/server/services/committees.ts'
import { CommitteesClient } from './CommitteesClient.tsx'

type Params = { orgSlug: string; conferenceId: string }

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  return { title: (await getConference(ctx, conferenceId)).name }
}

const STATUS_TONE = {
  DRAFT: 'neutral',
  OPEN: 'success',
  CLOSED: 'warning',
  ARCHIVED: 'neutral',
} as const

/**
 * The conference workspace.
 *
 * `pageCtx` resolves the conference against the caller's organisation before
 * anything renders, so a hand-edited id from another organisation reaches
 * Next's 404 page rather than this component.
 */
export default async function ConferencePage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })

  const [conference, committees] = await Promise.all([
    getConference(ctx, conferenceId),
    listCommittees(ctx),
  ])

  return (
    <>
      <PageHeader
        title={conference.name}
        description={
          conference.venue ?? 'Add dates, venue and fee in conference settings — arriving next.'
        }
        actions={
          <>
            <Badge tone={STATUS_TONE[conference.status]}>{conference.status.toLowerCase()}</Badge>
            <Button variant="secondary" asChild>
              <Link href={`/app/${orgSlug}/conferences/${conferenceId}/registrations`}>
                Registrations
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/app/${orgSlug}/conferences/${conferenceId}/delegates`}>Delegates</Link>
            </Button>
          </>
        }
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
