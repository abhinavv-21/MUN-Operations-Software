import type { Metadata } from 'next'
import Link from 'next/link'
import { pageCtx } from '@/server/page-ctx.ts'
import { listMyOrganizations } from '@/server/services/organizations.ts'
import { CreateOrganizationForm } from './CreateOrganizationForm.tsx'

export const metadata: Metadata = { title: 'Your organisations' }

export default async function AppHomePage() {
  // Called directly, not through fetch. The first paint needs no API round trip
  // and no second copy of the authorization rules.
  const ctx = await pageCtx()
  const organizations = await listMyOrganizations(ctx)

  return (
    <main className="page">
      <header className="page-header">
        <h1>Your organisations</h1>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className="button subtle">
            Sign out
          </button>
        </form>
      </header>

      {organizations.length > 0 ? (
        <ul className="cards">
          {organizations.map((organization) => (
            <li key={organization.id} className="card">
              <Link href={`/app/${organization.slug}`}>
                <strong>{organization.name}</strong>
              </Link>
              <p className="muted">
                /{organization.slug} · {organization.role.toLowerCase()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          You are not in an organisation yet. Create one, or ask someone to invite you.
        </p>
      )}

      <section className="panel">
        <h2>Create an organisation</h2>
        <CreateOrganizationForm />
      </section>
    </main>
  )
}
