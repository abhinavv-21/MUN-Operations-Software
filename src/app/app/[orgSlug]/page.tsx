import { CalendarDays } from 'lucide-react'
import { Card, CardHeader, Stat } from '@/components/ui/Card.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { EmptyState } from '@/components/ui/States.tsx'
import { RoleBadge } from '@/components/ui/Badge.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { pageCtx } from '@/server/page-ctx.ts'

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  return { title: requireOrg(ctx).organizationName }
}

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  // ctx.db is already organisation-scoped, so there is no `where` to forget and
  // no way for this to see another organisation's rows.
  const [conferences, memberCount] = await Promise.all([
    ctx.db.conference.findMany({
      select: { id: true, name: true, slug: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
    ctx.db.membership.count(),
  ])

  return (
    <>
      <PageHeader
        title={membership.organizationName}
        description="Everything this organisation runs, in one place."
        actions={<RoleBadge role={membership.orgRole} />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Conferences" value={conferences.length} emphasis />
        <Stat label="People" value={memberCount} hint="Members of this organisation" />
        <Stat label="Plan" value="Free" hint="Up to 2 conferences" />
      </div>

      <Card>
        <CardHeader
          title="Conferences"
          description="Each conference has its own committees, delegates and allocations."
        />
        {conferences.length > 0 ? (
          <ul className="divide-y divide-edge">
            {conferences.map((conference) => (
              <li key={conference.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-body text-ink">{conference.name}</span>
                <span className="text-body-sm text-ink-secondary">
                  {conference.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="No conferences yet"
            description="Creating and configuring conferences arrives in the next stage."
          />
        )}
      </Card>
    </>
  )
}
