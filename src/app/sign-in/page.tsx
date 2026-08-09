import type { Metadata, Route } from 'next'
import { redirect } from 'next/navigation'
import { safeNextPath } from '@/lib/safe-redirect.ts'
import { optionalClaims } from '@/server/auth/session.ts'
import { PRODUCT_NAME } from '@/lib/product.ts'
import { SignInForm } from './SignInForm.tsx'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams

  // Already signed in, so there is nothing to do here. The destination is
  // constrained to this origin — an unchecked `?next=` is an open redirect.
  const claims = await optionalClaims().catch(() => null)
  if (claims) redirect(safeNextPath(next) as Route)

  return (
    <main className="centred">
      <section className="panel">
        <h1>{PRODUCT_NAME}</h1>
        <p className="muted">Sign in to run your conference.</p>
        <SignInForm next={next} initialError={error} />
      </section>
    </main>
  )
}
