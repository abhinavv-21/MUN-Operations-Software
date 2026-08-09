import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, LogOut } from 'lucide-react'
import { RoleBadge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { EmptyState } from '@/components/ui/States.tsx'
import { redirect } from 'next/navigation'
import { pageCtx } from '@/server/page-ctx.ts'
import { optionalClaims } from '@/server/auth/session.ts'
import {
  createOrganization,
  listMyOrganizations,
  suggestSlug,
} from '@/server/services/organizations.ts'
import { CreateOrganizationForm } from './CreateOrganizationForm.tsx'

export const metadata: Metadata = { title: 'Your organisations' }

export default async function AppHomePage() {
  // Called directly, not through fetch. The first paint needs no API round trip
  // and no second copy of the authorization rules.
  const ctx = await pageCtx()
  let organizations = await listMyOrganizations(ctx)

  /*
    Someone who signed up gave us their organisation's name on the way in, so
    landing them on an empty page and asking for it again is asking twice. The
    name rides in the token's metadata; this is the first authenticated request
    that can act on it.

    Only when they belong to nothing. A member invited into an existing
    organisation has no name in their metadata and must not have one invented.
  */
  if (organizations.length === 0) {
    const claims = await optionalClaims().catch(() => null)
    const name = claims?.organizationName?.trim()

    if (name) {
      // Derived from the owner's id rather than the clock: a render must be
      // pure, and a slug that changes between two renders of the same page is
      // a different organisation each time.
      const slug = suggestSlug(name) || `org-${(ctx.user?.id ?? '').replace(/-/g, '').slice(0, 10)}`
      const created = await createOrganization(ctx, { name, slug }).catch(
        // A slug collision on the very first screen is not worth a dead end:
        // fall through and let them choose one below.
        () => null,
      )
      if (created) redirect(`/app/${created.slug}`)
      organizations = await listMyOrganizations(ctx)
    }
  }

  return (
    <main className="ground-app min-h-dvh px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-app">
        <PageHeader
          title="Your organisations"
          description="An organisation runs one or more conferences. It is where members and billing live."
          actions={
            <form action="/auth/sign-out" method="post">
              <Button variant="ghost" type="submit">
                <LogOut size={16} aria-hidden />
                Sign out
              </Button>
            </form>
          }
        />

        {organizations.length > 0 ? (
          <ul className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  href={`/app/${organization.slug}`}
                  className="block rounded-card border border-edge bg-surface p-5 transition-colors duration-micro ease-standard hover:border-edge-strong hover:bg-surface-sunken"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-heading text-h3 text-ink">{organization.name}</span>
                    <RoleBadge role={organization.role} />
                  </div>
                  <p className="mt-1 text-body-sm text-ink-secondary">/{organization.slug}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="mb-6">
            <EmptyState
              icon={Building2}
              title="You are not in an organisation yet"
              description="Create one below, or ask whoever runs your conference to invite you."
            />
          </Card>
        )}

        <Card className="max-w-xl">
          <CardHeader
            title="Create an organisation"
            description="You will be its owner. You can invite the rest of your team straight after."
          />
          <CreateOrganizationForm />
        </Card>
      </div>
    </main>
  )
}
