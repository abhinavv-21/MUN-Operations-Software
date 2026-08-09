import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { PermissionDenied } from '@/components/ui/States.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { isOrgAdmin } from '@/server/auth/membership.ts'
import { pageCtx } from '@/server/page-ctx.ts'
import { getConference } from '@/server/services/conferences.ts'
import { ConferenceSettingsClient } from './ConferenceSettingsClient.tsx'

export const metadata: Metadata = { title: 'Conference settings' }

type Params = { orgSlug: string; conferenceId: string }

/**
 * Organisation owner or admin, not conference ADMIN.
 *
 * Configuring and deleting a conference is the same power as creating one, and
 * the conference roles cannot express it — a CONTRIBUTOR on MUN XI has no
 * business deleting it, and an org admin who holds no conference grant still
 * must be able to. `updateConference` and `deleteConference` make the same
 * check; this only decides what to render.
 */
export default async function ConferenceSettingsPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  const membership = requireOrg(ctx)

  if (!isOrgAdmin(membership.orgRole)) {
    return <PermissionDenied what="Conference settings" />
  }

  const conference = await getConference(ctx, conferenceId)

  return (
    <>
      <PageHeader
        title="Conference settings"
        description="Dates, venue, fee and whether the public page is taking applications."
      />
      <ConferenceSettingsClient
        orgSlug={orgSlug}
        conference={{
          id: conference.id,
          name: conference.name,
          slug: conference.slug,
          edition: conference.edition,
          startsOn: conference.startsOn?.toISOString() ?? null,
          endsOn: conference.endsOn?.toISOString() ?? null,
          venue: conference.venue,
          feeMinorUnits: conference.feeMinorUnits,
          feeCurrency: conference.feeCurrency,
          registrationDeadline: conference.registrationDeadline?.toISOString() ?? null,
          status: conference.status,
        }}
      />
    </>
  )
}
