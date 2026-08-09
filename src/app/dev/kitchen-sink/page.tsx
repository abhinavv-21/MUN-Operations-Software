import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { CalendarDays } from 'lucide-react'
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
    committee: string
    country: string
    seats: number
  }

  const rows: Row[] = [
    { id: '1', committee: 'UNSC', country: 'France', seats: 15 },
    { id: '2', committee: 'WHO', country: 'Japan', seats: 40 },
    { id: '3', committee: 'DISEC', country: 'Brazil', seats: 60 },
  ]

  const columns: Column<Row>[] = [
    { key: 'committee', header: 'Committee', render: (row) => row.committee },
    { key: 'country', header: 'Country', render: (row) => row.country, secondary: true },
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
          <CardHeader title="Grounds" description="Each republishes the same seven locals." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {GROUNDS.map((ground) => (
              <div key={ground} className={`ground-${ground} rounded-card p-4`}>
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
          <CardHeader title="Buttons" description="Four variants, three sizes, plus loading." />
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Delegates" value={248} emphasis />
          <Stat label="Committees" value={6} hint="Across two conferences" />
          <Stat label="Unallocated" value={12} />
          <Card>
            <CapacityMeter filled={14} total={15} label="UNSC" />
            <div className="mt-4">
              <CapacityMeter filled={40} total={40} label="WHO" />
            </div>
            <div className="mt-4">
              <CapacityMeter filled={9} total={60} label="DISEC" />
            </div>
          </Card>
        </div>

        <Card className="p-0 md:p-0">
          <div className="p-5 pb-0 md:p-6 md:pb-0">
            <CardHeader title="Data table" description="Scrolls inside itself, never the body." />
          </div>
          <DataTable
            caption="Example allocations"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            className="rounded-none border-0 border-t border-edge"
          />
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

        <Card className="p-0 md:p-0">
          <div className="p-5 md:p-6">
            <CardHeader title="Loading" description="Skeletons match the final row height." />
          </div>
          <SkeletonRows rows={3} />
          <div className="p-5 md:p-6">
            <SkeletonCards count={4} />
          </div>
        </Card>

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
