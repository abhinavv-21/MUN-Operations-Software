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
    <main className="ground-app grid min-h-dvh place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-card border border-edge bg-surface p-6 md:p-8">
        <h1 className="font-heading text-h1 text-ink">{PRODUCT_NAME}</h1>
        <span className="page-rule mt-3" aria-hidden />
        <p className="mt-4 mb-6 text-body text-ink-secondary">
          Sign in to run your conference.
        </p>
        <SignInForm next={next} initialError={error} />
      </section>
    </main>
  )
}
