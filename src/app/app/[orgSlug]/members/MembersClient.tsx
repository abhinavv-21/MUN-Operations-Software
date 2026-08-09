'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Member {
  userId: string
  email: string
  fullName: string | null
  role: string
  canManageMembers: boolean
  joinedAt: string
}

interface Invitation {
  id: string
  email: string
  orgRole: string
  acceptedAt: string | null
  expiresAt: string
}

interface ApiFailure {
  error?: string
  code?: number
  details?: unknown
}

type CallResult = { ok: true; body: Record<string, unknown> } | { ok: false; message: string }

/**
 * Every failure is `{ error, code, details? }`, so one reader handles them all.
 * A 422 carries `[{ path, message }]`, which is the operator-facing text.
 */
async function call(url: string, init: RequestInit): Promise<CallResult> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
  const body: Record<string, unknown> & ApiFailure = await response
    .json()
    .catch(() => ({}) as ApiFailure)

  if (response.ok) return { ok: true, body }

  const details = body.details
  const firstIssue =
    Array.isArray(details) && typeof details[0] === 'object' && details[0] !== null
      ? (details[0] as { message?: string }).message
      : undefined

  return { ok: false, message: firstIssue ?? body.error ?? 'Something went wrong' }
}

export function MembersClient({
  orgSlug,
  currentUserId,
  currentUserRole,
  initialMembers,
  initialInvitations,
}: {
  orgSlug: string
  currentUserId: string
  currentUserRole: string
  initialMembers: Member[]
  initialInvitations: Invitation[]
}) {
  const router = useRouter()
  const [members] = useState(initialMembers)
  const [invitations] = useState(initialInvitations)
  const [email, setEmail] = useState('')
  const [orgRole, setOrgRole] = useState('MEMBER')
  const [issuedLink, setIssuedLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ownerCount = members.filter((member) => member.role === 'OWNER').length

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setIssuedLink(null)

    const result = await call(`/api/orgs/${orgSlug}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, orgRole }),
    })
    setBusy(false)

    if (!result.ok) return setError(result.message)

    // Shown once, because nothing stored can produce it again. v1 sends no
    // email of its own — the organiser forwards this with the mail client they
    // already use.
    setIssuedLink(`${window.location.origin}/invite?token=${result.body.token}`)
    setEmail('')
    router.refresh()
  }

  async function changeRole(userId: string, role: string) {
    setError(null)
    const result = await call(`/api/orgs/${orgSlug}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    if (!result.ok) return setError(result.message)
    router.refresh()
  }

  async function remove(userId: string) {
    setError(null)
    const result = await call(`/api/orgs/${orgSlug}/members/${userId}`, { method: 'DELETE' })
    if (!result.ok) return setError(result.message)
    router.refresh()
  }

  return (
    <div className="stack">
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Manage members</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isLastOwner = member.role === 'OWNER' && ownerCount === 1
            return (
              <tr key={member.userId}>
                <td>
                  {member.fullName ?? member.email}
                  <br />
                  <span className="muted">{member.email}</span>
                </td>
                <td>
                  <select
                    value={member.role}
                    disabled={isLastOwner || currentUserRole === 'MEMBER'}
                    onChange={(event) => changeRole(member.userId, event.target.value)}
                  >
                    <option value="OWNER" disabled={currentUserRole !== 'OWNER'}>
                      Owner
                    </option>
                    <option value="ADMIN">Admin</option>
                    <option value="MEMBER">Member</option>
                  </select>
                  {/* Disabled here as a courtesy. The server refuses it either
                      way, which is the check that counts. */}
                  {isLastOwner ? <p className="muted">The only owner</p> : null}
                </td>
                <td>{member.canManageMembers ? 'Yes' : 'No'}</td>
                <td>
                  <button
                    type="button"
                    className="button subtle"
                    disabled={isLastOwner || member.userId === currentUserId}
                    onClick={() => remove(member.userId)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <section className="panel">
        <h2>Invite someone</h2>
        <form onSubmit={invite} className="stack">
          <label htmlFor="invite-email">Email address</label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="them@school.edu"
          />
          <label htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            value={orgRole}
            onChange={(event) => setOrgRole(event.target.value)}
          >
            <option value="MEMBER">Member — access only to conferences you grant</option>
            <option value="ADMIN">Admin — full access to every conference</option>
          </select>
          <button type="submit" disabled={busy || email.length === 0} className="button">
            {busy ? 'Creating…' : 'Create invitation link'}
          </button>
        </form>

        {issuedLink ? (
          <div role="status" className="stack">
            <p>Send them this link. It is shown once and works for 14 days.</p>
            <input readOnly value={issuedLink} onFocus={(event) => event.target.select()} />
          </div>
        ) : null}
      </section>

      {invitations.length > 0 ? (
        <section className="panel">
          <h2>Pending invitations</h2>
          <ul>
            {invitations
              .filter((invitation) => !invitation.acceptedAt)
              .map((invitation) => (
                <li key={invitation.id}>
                  {invitation.email} · {invitation.orgRole.toLowerCase()} · expires{' '}
                  {new Date(invitation.expiresAt).toLocaleDateString()}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
