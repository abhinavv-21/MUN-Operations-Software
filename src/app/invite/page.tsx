import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalClaims } from '@/server/auth/session.ts'
import { previewInvitation } from '@/server/services/invitations.ts'
import { isApiError } from '@/server/errors.ts'
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
      <main className="centred">
        <section className="panel">
          <h1>That link is incomplete</h1>
          <p className="muted">Ask whoever invited you to send it again.</p>
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
      <main className="centred">
        <section className="panel">
          <h1>That invitation is no longer valid</h1>
          <p className="muted">
            It may have been used already, revoked, or simply expired. Ask for a new one.
          </p>
          <Link href="/app">Go to your organisations</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="centred">
      <section className="panel">
        <h1>Join {invitation.organizationName}</h1>
        <p>
          You have been invited as <strong>{invitation.orgRole.toLowerCase()}</strong>.
        </p>

        {invitation.emailMismatch ? (
          <p role="note">
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
