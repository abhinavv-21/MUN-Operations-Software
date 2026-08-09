import { pageCtx } from '@/server/page-ctx.ts'
import { requireOrg } from '@/server/ctx.ts'

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

  // Conferences arrive in Stage 4. ctx.db is already organisation-scoped, so
  // this needs no `where` and cannot see another organisation's rows.
  const conferences = await ctx.db.conference.findMany({
    select: { id: true, name: true, slug: true, status: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <main className="page">
      <header className="page-header">
        <h1>{membership.organizationName}</h1>
        <p className="muted">You are {membership.orgRole.toLowerCase()} here.</p>
      </header>

      <section className="panel">
        <h2>Conferences</h2>
        {conferences.length > 0 ? (
          <ul>
            {conferences.map((conference) => (
              <li key={conference.id}>
                {conference.name} <span className="muted">({conference.status.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No conferences yet. Creating them arrives in Stage 4.</p>
        )}
      </section>
    </main>
  )
}
