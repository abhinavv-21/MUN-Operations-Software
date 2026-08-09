import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalClaims } from '@/server/auth/session.ts'
import { previewInvitation } from '@/server/services/invitations.ts'
import { isApiError } from '@/server/errors.ts'
import { Button } from '@/components/ui/Button.tsx'
import { AcceptInvitation } from './AcceptInvitation.tsx'

export const metadata: Metadata = { title: 'Invitation' }

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (!token) {
    return (
      <main className="ground-app grid min-h-dvh place-items-center px-5 py-12">
        <section className="w-full max-w-md rounded-card border border-edge bg-surface p-6 md:p-8">
          <h1 className="font-heading text-h2 text-ink">That link is incomplete</h1>
          <p className="mt-2 text-body text-ink-secondary">
            Ask whoever invited you to send it again.
          </p>
        </section>
      </main>
    )
  }

  const claims = await optionalClaims().catch(() => null)
  if (!claims) {
    // Back here afterwards, with the token intact.
    redirect(`/sign-in?next=${encodeURIComponent(`/invite?token=${token}`)}`)
  }

  let invitation
  try {
    invitation = await previewInvitation(token, claims.email)
  } catch (error) {
    if (!isApiError(error) || error.code !== 404) throw error
    return (
      <main className="ground-app grid min-h-dvh place-items-center px-5 py-12">
        <section className="w-full max-w-md rounded-card border border-edge bg-surface p-6 md:p-8">
          <h1 className="font-heading text-h2 text-ink">That invitation is no longer valid</h1>
          <p className="mt-2 mb-5 text-body text-ink-secondary">
            It may have been used already, revoked, or simply expired. Ask for a new one.
          </p>
          <Button variant="secondary" asChild>
            <Link href="/app">Go to your organisations</Link>
          </Button>
        </section>
      </main>
    )
  }

  return (
    <main className="ground-app grid min-h-dvh place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-card border border-edge bg-surface p-6 md:p-8">
        <h1 className="font-heading text-h1 text-ink">Join {invitation.organizationName}</h1>
        <span className="page-rule mt-3" aria-hidden />
        <p className="mt-4 text-body text-ink-secondary">
          You have been invited as <strong className="text-ink">{invitation.orgRole.toLowerCase()}</strong>.
        </p>

        {invitation.emailMismatch ? (
          <p className="mt-4 rounded-card border border-edge bg-warning-wash p-4 text-body-sm text-ink">
            This invitation was addressed to <strong>{invitation.invitedEmail}</strong>, and you are
            signed in as <strong>{claims.email}</strong>. Accepting will add the account you are
            signed in with.
          </p>
        ) : null}

        {/* The token is the authority; the email is a hint. People forward
            invitations to the address they actually read, and refusing would
            strand them with no way through. */}
        <AcceptInvitation token={token} />
      </section>
    </main>
  )
}
