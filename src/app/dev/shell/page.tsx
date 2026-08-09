import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Pencil, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { CapacityMeter, Card, CardHeader, Stat } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Input, Select } from '@/components/ui/Field.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { AppShell } from '@/components/layout/AppShell.tsx'
import { ConferenceNav } from '@/components/layout/ConferenceNav.tsx'

export const metadata: Metadata = { title: 'Shell' }

/**
 * The shell, the conference strip and a table at real volume, on one page.
 *
 * `/dev/kitchen-sink` renders the kit as a catalogue of parts, which is the
 * wrong instrument for three of the components: `AppShell`, `ConferenceNav` and
 * `DataTable` are only judgeable at the size and density they actually run at.
 * A three-row example table proves nothing about what forty rows feel like to
 * scan, and a navigation rail cannot be reviewed inside a card.
 *
 * Both `AppShell` and `ConferenceNav` take `currentPath` so the active states —
 * most of what there is to look at — render on a route that is not `/app`.
 *
 * Not reachable in production, same as the kitchen sink.
 */
export default function ShellPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const ORG = 'demo-mun-society'
  const CONFERENCE = 'conf-preview'
  const HERE = `/app/${ORG}/conferences/${CONFERENCE}/delegates`

  interface Row {
    id: string
    name: string
    email: string
    school: string
    committee: string | null
    country: string | null
    seats: number
  }

  const FIRST = [
    'Priya',
    'Aarav',
    'Ishaan',
    'Ananya',
    'Rohan',
    'Meera',
    'Kabir',
    'Sana',
    'Vihaan',
    'Diya',
    'Arjun',
    'Nikhil',
  ]
  const LAST = [
    'Sharma',
    'Iyer',
    'Banerjee',
    'Kulkarni',
    'Menon',
    'Rao',
    'Chatterjee',
    'Desai',
    'Nair',
    'Gupta',
    'Reddy',
    'Bose',
  ]
  const SCHOOLS = [
    'St Xavier’s Collegiate',
    'Delhi Public School, R.K. Puram',
    'Cathedral & John Connon',
    'The Doon School',
    'Bishop Cotton Boys’',
  ]
  const COMMITTEES = ['UNSC', 'WHO', 'DISEC', 'UNHRC', 'ECOSOC', 'UNEP']
  const COUNTRIES = [
    'France',
    'Japan',
    'Brazil',
    'Kenya',
    'Norway',
    'Chile',
    'Viet Nam',
    'Portugal',
    'Ghana',
  ]

  // Forty rows, deterministic, so the picture is the same on every run.
  const rows: Row[] = Array.from({ length: 40 }, (_, index) => {
    const allocated = index % 5 !== 3
    return {
      id: String(index),
      name: `${FIRST[index % FIRST.length]} ${LAST[(index * 5) % LAST.length]}`,
      email: `${FIRST[index % FIRST.length]!.toLowerCase()}.${LAST[(index * 5) % LAST.length]!.toLowerCase()}@school.example`,
      school: SCHOOLS[index % SCHOOLS.length]!,
      committee: allocated ? COMMITTEES[index % COMMITTEES.length]! : null,
      country: allocated ? COUNTRIES[index % COUNTRIES.length]! : null,
      seats: 12 + ((index * 7) % 48),
    }
  })

  const columns: Column<Row>[] = [
    {
      key: 'delegate',
      header: 'Delegate',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{row.name}</p>
          <p className="truncate text-body-sm text-ink-secondary">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'school',
      header: 'School',
      secondary: true,
      render: (row) => <span className="text-ink-secondary">{row.school}</span>,
    },
    {
      key: 'allocation',
      header: 'Allocation',
      render: (row) =>
        row.committee ? (
          <div className="flex items-center gap-2">
            <Badge tone="success">{row.committee}</Badge>
            <span className="text-body text-ink">{row.country}</span>
          </div>
        ) : (
          <Badge tone="warning">Unallocated</Badge>
        ),
    },
    { key: 'seats', header: 'Seats', numeric: true, render: (row) => row.seats },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" aria-label={`Edit ${row.name}`}>
            <Pencil size={16} aria-hidden />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <AppShell
      orgSlug={ORG}
      organizationName="Demo MUN Society"
      userEmail="owner@demo.invalid"
      canManageMembers
      isOrgAdmin
      currentPath={HERE}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-label uppercase text-ink-secondary">Conferences</span>
          <span className="text-ink-tertiary" aria-hidden>
            /
          </span>
          <span className="truncate font-heading text-h3 text-ink">Bengal MUN 2026</span>
        </div>
        <Badge tone="success">open</Badge>
      </div>

      <ConferenceNav orgSlug={ORG} conferenceId={CONFERENCE} isAdmin currentPath={HERE} />

      {/* Sibling of the content column, exactly as every real page renders it. */}
      <PageHeader
        title="Delegates"
        description="Approved applicants, and where they sit. Search, then allocate."
        actions={
          <>
            <Button variant="secondary">Import matrix</Button>
            <Button>Add delegate</Button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Delegates" value={96} emphasis hint="Approved and confirmed" />
          <Stat label="Unallocated" value={8} />
          <Stat label="Committees" value={6} />
          <Stat label="Countries" value={99} hint="Across the matrix" />
        </div>

        <Card>
          <CardHeader
            title="Filter"
            description="Filters narrow the table below without reloading the page."
          />
          <div className="flex flex-col gap-3 md:flex-row">
            <Input placeholder="Search name, email or school" className="md:max-w-sm" />
            <Select className="md:max-w-52" defaultValue="any">
              <option value="any">Any allocation</option>
              <option value="allocated">Allocated</option>
              <option value="unallocated">Unallocated</option>
            </Select>
          </div>
        </Card>

        <Card className="p-0 md:p-0">
          <div className="p-5 pb-4 md:p-6 md:pb-4">
            <CardHeader
              title="Delegates"
              description="Forty of ninety-six. Scroll to judge the row rhythm."
              actions={<Button variant="secondary" size="sm">Export CSV</Button>}
            />
            <div className="grid max-w-md gap-2.5">
              <CapacityMeter filled={14} total={15} label="UNSC" />
              <CapacityMeter filled={40} total={40} label="WHO" />
              <CapacityMeter filled={9} total={60} label="DISEC" />
            </div>
          </div>
          <DataTable
            caption="Delegates in this conference"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            className="rounded-none border-0 border-t border-edge"
          />
        </Card>

        <Card>
          <CardHeader
            title="Empty committee"
            description="Shown when a filter matches nothing."
            actions={
              <Button variant="secondary" size="sm">
                Clear filters
              </Button>
            }
          />
          <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
            <Users size={16} aria-hidden />
            Ninety-six delegates, six committees, two days of attendance.
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
