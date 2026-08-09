import Link from 'next/link'
import { AlertTriangle, ClipboardCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { CapacityMeter, Card, CardHeader, Stat } from '@/components/ui/Card.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { EmptyState } from '@/components/ui/States.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { getConference } from '@/server/services/conferences.ts'
import { conferenceDashboard } from '@/server/services/dashboard.ts'

type Params = { orgSlug: string; conferenceId: string }

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  return { title: (await getConference(ctx, conferenceId)).name }
}

/**
 * The conference dashboard.
 *
 * A Server Component with no client query behind it, deliberately. Every number
 * here is read at a glance and acted on somewhere else, and a screen that
 * refetches on focus while someone is reading it out loud is worse than one
 * that is a minute old. The sections it points at are all live.
 *
 * Rendered dynamically because `pageCtx` reads the session cookie; there is no
 * cached variant of this page to leak between organisations.
 */
export default async function ConferenceDashboardPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })

  const [conference, dashboard] = await Promise.all([
    getConference(ctx, conferenceId),
    conferenceDashboard(ctx),
  ])

  /*
    Every href below is written out in full rather than composed from a `base`
    constant. Next's typed routes describe a path as a template literal type,
    and concatenating onto a `base` string widens it to `${string}/attendance`,
    which matches no known route — so every Link becomes a type error.
    Inference off the whole literal keeps it intact.
  */
  const { attendance, logistics } = dashboard

  return (
    <>
      <PageHeader
        title={conference.name}
        description={
          conference.venue ??
          'Add dates, venue and fee in conference settings — arriving in the next stage.'
        }
        actions={
          <Button asChild>
            <Link href={`/app/${orgSlug}/conferences/${conferenceId}/attendance`}>
              <ClipboardCheck size={16} aria-hidden />
              Check delegates in
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Present today`}
          value={attendance.present + attendance.late}
          hint={`${attendance.unmarked} not yet marked · ${dashboard.day}`}
          emphasis
        />
        <Stat label="Delegates" value={dashboard.delegates} hint={`${dashboard.committees} committees`} />
        <Stat
          label="Unallocated"
          value={dashboard.unallocated}
          hint={dashboard.unallocated === 0 ? 'Everyone has a seat' : 'Delegates with no committee'}
        />
        <Stat
          label="Logistics open"
          value={logistics.OPEN + logistics.IN_PROGRESS}
          hint={
            logistics.urgentOutstanding > 0
              ? `${logistics.urgentOutstanding} urgent`
              : 'Nothing urgent'
          }
        />
      </div>

      {dashboard.urgent.length > 0 ? (
        <Card className="mb-6 border-danger">
          <CardHeader
            title="Urgent, still open"
            description="Raised as urgent and not yet resolved."
            actions={
              <Button variant="secondary" asChild>
                <Link href={`/app/${orgSlug}/conferences/${conferenceId}/logistics`}>Open logistics</Link>
              </Button>
            }
          />
          <ul className="divide-y divide-edge">
            {dashboard.urgent.map((request) => (
              <li key={request.id} className="flex items-center gap-3 py-3">
                <AlertTriangle size={16} className="shrink-0 text-danger" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body text-ink">{request.title}</span>
                {request.committee ? <Badge tone="neutral">{request.committee}</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={`Register — ${dashboard.day}`}
            description="Today's attendance, as it stands."
            actions={
              <Button variant="secondary" asChild>
                <Link href={`/app/${orgSlug}/conferences/${conferenceId}/attendance`}>Open register</Link>
              </Button>
            }
          />
          {dashboard.delegates === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No delegates yet"
              description="Approve an application and the delegate appears in the register."
            />
          ) : (
            <>
              <CapacityMeter
                filled={attendance.present + attendance.late}
                total={attendance.total}
                label="Marked present"
                unit="delegates"
              />
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Present', attendance.present],
                  ['Late', attendance.late],
                  ['Absent', attendance.absent],
                  ['Not marked', attendance.unmarked],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-label uppercase text-ink-secondary">{label}</dt>
                    <dd className="font-mono text-data tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Committees"
            description="Seats filled, committee by committee."
            actions={
              <Button variant="secondary" asChild>
                <Link href={`/app/${orgSlug}/conferences/${conferenceId}/committees`}>Open committees</Link>
              </Button>
            }
          />
          {dashboard.committeeLoad.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No committees yet"
              description="Add one before allocating anybody."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {dashboard.committeeLoad.map((committee) => (
                <li key={committee.id}>
                  {committee.seats !== null ? (
                    <CapacityMeter
                      filled={committee.filled}
                      total={committee.seats}
                      label={committee.code}
                    />
                  ) : (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-body-sm text-ink-secondary">{committee.code}</span>
                      <span className="font-mono text-data tabular-nums text-ink-secondary">
                        {committee.filled} allocated
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dashboard.pendingRegistrations > 0 ? (
        <Card className="mt-6">
          <CardHeader
            title="Waiting on you"
            description={`${dashboard.pendingRegistrations} application${
              dashboard.pendingRegistrations === 1 ? '' : 's'
            } still to review.`}
            actions={
              <Button asChild>
                <Link href={`/app/${orgSlug}/conferences/${conferenceId}/registrations`}>Review applications</Link>
              </Button>
            }
          />
        </Card>
      ) : null}
    </>
  )
}
