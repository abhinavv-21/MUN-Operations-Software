import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PRODUCT_NAME } from '@/lib/product.ts'
import { pageCtx } from '@/server/page-ctx.ts'
import { requireUser } from '@/server/ctx.ts'
import { optionalClaims } from '@/server/auth/session.ts'
import { listMembershipsForUser } from '@/server/scope-resolution.ts'
import { OnboardingForm } from './OnboardingForm.tsx'

export const metadata: Metadata = { title: 'Finish setting up' }

export default async function OnboardingPage() {
  const ctx = await pageCtx()
  const user = requireUser(ctx)

  // Already done. Coming back here by typing the URL should not offer to redo
  // a step that is finished.
  if (user.profileCompletedAt) redirect('/app')

  const claims = await optionalClaims().catch(() => null)
  const memberships = await listMembershipsForUser(user.id)

  // Someone who signed in with a password gave us everything at sign-up and
  // already has a credential. Google gave us a name and nothing else.
  const needsPassword = claims?.provider !== undefined && claims.provider !== 'email'

  return (
    <main className="ground-app grid min-h-dvh place-items-center px-5 py-12">
      <section className="w-full max-w-lg rounded-card border border-edge bg-surface p-6 md:p-8">
        <h1 className="font-heading text-h1 text-ink">Finish setting up</h1>
        <span className="page-rule mt-3" aria-hidden />
        <p className="mt-4 mb-6 text-body text-ink-secondary">
          {PRODUCT_NAME} needs a little more before you can run a conference. This is asked once.
        </p>

        <OnboardingForm
          needsPassword={needsPassword}
          initial={{
            firstName: user.firstName ?? '',
            lastName: user.lastName ?? '',
            phone: user.phone ?? '',
            address: user.address ?? '',
            organizationName: claims?.organizationName ?? '',
            needsOrganization: memberships.length === 0,
          }}
        />
      </section>
    </main>
  )
}
