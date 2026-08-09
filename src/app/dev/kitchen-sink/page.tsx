import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { CalendarDays, Pencil } from 'lucide-react'
import { Badge, InvitationBadge, RoleBadge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { CapacityMeter, Card, CardHeader, Stat } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { SaveIndicator } from '@/components/ui/SaveIndicator.tsx'
import {
  EmptyState,
  ErrorState,
  PermissionDenied,
  SkeletonCards,
  SkeletonRows,
} from '@/components/ui/States.tsx'
import { GROUNDS } from '@/lib/theme/build.ts'
import { KitchenSinkInteractive } from './KitchenSinkInteractive.tsx'

export const metadata: Metadata = { title: 'Kitchen sink' }

/**
 * Every component, in every state, on one page.
 *
 * This is how a theme change is judged. A palette that looks fine on the
 * dashboard can still put a badge at 2:1 or leave a disabled button
 * indistinguishable from an enabled one, and those are only visible side by
 * side.
 *
 * Not reachable in production. It is a development tool, and a route that
 * renders every internal component is not something to leave open.
 */
export default function KitchenSinkPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  interface Row {
    id: string
    delegate: string
    email: string
    committee: string
    country: string | null
    seats: number
  }

  /*
    Deliberately mixed: two rows carry a two-line identity cell and one does
    not, because the row height has to be a floor rather than a fixed value and
    that is only visible when both shapes are on screen together.
  */
  const rows: Row[] = [
    { id: '1', delegate: 'Priya Sharma', email: 'priya.sharma@school.example', committee: 'UNSC', country: 'France', seats: 15 },
    { id: '2', delegate: 'Aarav Menon', email: 'aarav.menon@school.example', committee: 'WHO', country: 'Japan', seats: 40 },
    { id: '3', delegate: 'Ananya Bose', email: '', committee: 'DISEC', country: null, seats: 60 },
  ]

  const columns: Column<Row>[] = [
    {
      key: 'delegate',
      header: 'Delegate',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{row.delegate}</p>
          {row.email ? (
            <p className="truncate text-body-sm text-ink-secondary">{row.email}</p>
          ) : null}
        </div>
      ),
    },
    { key: 'committee', header: 'Committee', render: (row) => row.committee, secondary: true },
    {
      key: 'country',
      header: 'Allocation',
      render: (row) =>
        row.country ? (
          <div className="flex items-center gap-2">
            <Badge tone="success">{row.committee}</Badge>
            <span className="text-body text-ink">{row.country}</span>
          </div>
        ) : (
          <Badge tone="warning">Unallocated</Badge>
        ),
    },
    { key: 'seats', header: 'Seats', numeric: true, render: (row) => row.seats },
  ]

  return (
    <main className="ground-app min-h-dvh px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-app flex-col gap-8">
        <PageHeader
          title="Kitchen sink"
          description="Every component in every state. Change a conference theme and reload: nothing here is rebuilt."
          actions={<Button variant="secondary">Secondary action</Button>}
        />

        <Card>
          <CardHeader
            title="Grounds"
            description="Each republishes the same seven locals. This card is the instrument for judging them: if a muted line ever looks identical to the line above it, or a swatch edge takes the colour of its text, the ground vocabulary has stopped reaching Tailwind — see the @theme inline block in tokens.css and the reason it has to be inline."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {GROUNDS.map((ground) => (
              <div key={ground} className={`ground-${ground} rounded-card border border-hairline p-4`}>
                <p className="text-label uppercase">.ground-{ground}</p>
                <p className="mt-2 text-body">On-ground text</p>
                <p className="text-body-sm text-on-ground-muted">Muted text</p>
                <span className="mt-3 inline-block rounded-control border border-border-interactive px-2 py-1 text-body-sm text-accent-on-ground">
                  Interactive edge
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Buttons"
            description="Four variants across rest, loading and disabled. Loading must never look disabled — that is a real regression this grid exists to catch."
          />
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
            {(
              [
                ['Rest', {}],
                ['Loading', { loading: true }],
                ['Disabled', { disabled: true }],
              ] as const
            ).map(([label, state]) => (
              <Fragment key={label}>
                <p className="text-label uppercase text-ink-secondary sm:pr-4">{label}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button {...state}>Primary</Button>
                  <Button variant="secondary" {...state}>
                    Secondary
                  </Button>
                  <Button variant="ghost" {...state}>
                    Ghost
                  </Button>
                  <Button variant="destructive" {...state}>
                    Destructive
                  </Button>
                </div>
              </Fragment>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-edge pt-5">
            <Button size="sm">Small</Button>
            <Button size="sm" variant="secondary">
              Small secondary
            </Button>
            <Button size="icon" aria-label="Edit">
              <Pencil size={16} aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Edit">
              <Pencil size={16} aria-hidden />
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/dev/shell">The shell, the strip and forty rows →</Link>
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Badges" description="Never colour alone — always an icon and a word." />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="neutral">Neutral</Badge>
            <RoleBadge role="OWNER" />
            <RoleBadge role="ADMIN" />
            <RoleBadge role="MEMBER" />
            <InvitationBadge accepted={false} />
            <InvitationBadge accepted />
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Delegates" value={248} emphasis />
          <Stat label="Committees" value={6} hint="Across two conferences" />
          <Stat label="Unallocated" value={12} />
          <Card className="flex flex-col justify-center gap-3">
            <CapacityMeter filled={14} total={15} label="UNSC" />
            <CapacityMeter filled={40} total={40} label="WHO" />
            <CapacityMeter filled={9} total={60} label="DISEC" />
            {/* No label: the count must still sit at the right-hand end of the
                bar it describes. */}
            <CapacityMeter filled={31} total={44} unit="present" />
          </Card>
        </div>

        <Card className="p-0 md:p-0">
          <div className="p-5 pb-4 md:p-6 md:pb-4">
            <CardHeader
              title="Data table"
              description="Scrolls inside itself, never the body. Rows are at least 52px and grow for two-line content; the header is a band, not a rule."
              actions={
                <Button variant="secondary" size="sm">
                  Export
                </Button>
              }
            />
          </div>
          <DataTable
            caption="Example allocations"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            className="rounded-none border-0 border-t border-edge"
          />
        </Card>

        <Card className="p-0 md:p-0">
          <div className="p-5 pb-4 md:p-6 md:pb-4">
            <CardHeader
              title="Data table, loading"
              description="The skeleton draws the header band and the same row height, so nothing moves when the data lands. Compare it against the table above."
            />
          </div>
          <div className="border-t border-edge">
            <SkeletonRows rows={4} columns={4} />
          </div>
        </Card>

        <KitchenSinkInteractive />

        <Card>
          <CardHeader title="Save indicator" />
          <div className="flex flex-wrap items-center gap-6">
            <SaveIndicator state="saving" />
            <SaveIndicator state="saved" />
            <SaveIndicator state="error" />
          </div>
        </Card>

        <div>
          <CardHeader
            title="Loading, stats"
            description="Matches the Stat cards above: same padding, same 40px number."
          />
          <SkeletonCards count={4} />
        </div>

        <Card>
          <CardHeader title="Empty" />
          <EmptyState
            icon={CalendarDays}
            title="No conferences yet"
            description="Create one to start adding committees and delegates."
            action={<Button>Create a conference</Button>}
          />
        </Card>

        <div className="flex flex-col gap-4">
          <ErrorState message="The country matrix could not be parsed. Row 14 names a committee that does not exist." />
          <ErrorState offline message="The request was not sent." />
          <Card>
            <PermissionDenied what="Member management" />
          </Card>
        </div>
      </div>
    </main>
  )
}
