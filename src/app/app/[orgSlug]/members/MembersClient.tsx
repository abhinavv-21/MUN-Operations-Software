'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Copy, UserPlus } from 'lucide-react'
import { Badge, InvitationBadge, RoleBadge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Field, Input, Select } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { ErrorState } from '@/components/ui/States.tsx'

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
  members,
  invitations,
}: {
  orgSlug: string
  currentUserId: string
  currentUserRole: string
  members: Member[]
  invitations: Invitation[]
}) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [orgRole, setOrgRole] = useState('MEMBER')
  const [issuedLink, setIssuedLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ownerCount = members.filter((member) => member.role === 'OWNER').length
  const pending = invitations.filter((invitation) => !invitation.acceptedAt)

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const result = await call(`/api/orgs/${orgSlug}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, orgRole }),
    })
    setBusy(false)

    if (!result.ok) return setError(result.message)

    // Shown once, because nothing stored can reproduce it. v1 sends no email of
    // its own — the organiser forwards this with the mail client they have.
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

  const columns: Column<Member>[] = [
    {
      key: 'person',
      header: 'Person',
      render: (member) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{member.fullName ?? member.email}</p>
          <p className="truncate text-body-sm text-ink-secondary">{member.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (member) => {
        const isLastOwner = member.role === 'OWNER' && ownerCount === 1
        if (isLastOwner || currentUserRole === 'MEMBER') {
          return (
            <div className="flex flex-col gap-1">
              <RoleBadge role={member.role} />
              {isLastOwner ? (
                <span className="text-body-sm text-ink-tertiary">The only owner</span>
              ) : null}
            </div>
          )
        }
        return (
          <Select
            aria-label={`Role for ${member.email}`}
            value={member.role}
            onChange={(event) => changeRole(member.userId, event.target.value)}
            className="max-w-40"
          >
            <option value="OWNER" disabled={currentUserRole !== 'OWNER'}>
              Owner
            </option>
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
          </Select>
        )
      },
    },
    {
      key: 'manage',
      header: 'Manages members',
      secondary: true,
      render: (member) =>
        member.canManageMembers || member.role === 'OWNER' ? (
          <Badge tone="info">Yes</Badge>
        ) : (
          <span className="text-ink-tertiary">No</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (member) => {
        const isLastOwner = member.role === 'OWNER' && ownerCount === 1
        // Omitted rather than disabled where it cannot apply at all.
        if (isLastOwner || member.userId === currentUserId) return null
        return (
          <Button variant="ghost" size="sm" onClick={() => remove(member.userId)}>
            Remove
          </Button>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {error ? <ErrorState message={error} /> : null}

      <Card className="p-0 md:p-0">
        <div className="p-5 pb-0 md:p-6 md:pb-0">
          <CardHeader
            title="People"
            description="Owners and admins can reach every conference. Members reach only what they are granted."
            actions={
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus size={16} aria-hidden />
                Invite
              </Button>
            }
          />
        </div>
        <DataTable
          caption="Members of this organisation"
          columns={columns}
          rows={members}
          rowKey={(member) => member.userId}
          className="rounded-none border-0 border-t border-edge"
        />
      </Card>

      {pending.length > 0 ? (
        <Card>
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-edge">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {invitation.email}
                </span>
                <RoleBadge role={invitation.orgRole} />
                <InvitationBadge accepted={false} />
                <span className="text-body-sm text-ink-secondary">
                  expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Modal
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open)
          if (!open) setIssuedLink(null)
        }}
        title="Invite someone"
        description="They will join this organisation when they open the link."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Close
            </Button>
            <Button type="submit" form="invite-form" loading={busy} disabled={email.length === 0}>
              Create link
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={invite} className="flex flex-col gap-4">
          <Field label="Email address" required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                required
                value={email}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="them@school.edu"
              />
            )}
          </Field>

          <Field
            label="Role"
            hint="Members see only the conferences you grant them. Admins see all of them."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={orgRole}
                onChange={(event) => setOrgRole(event.target.value)}
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </Select>
            )}
          </Field>
        </form>

        {issuedLink ? (
          <div role="status" className="mt-4 rounded-card border border-edge bg-accent-wash p-4">
            <p className="text-body-sm text-ink">
              Send them this link. It is shown once and works for 14 days.
            </p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={issuedLink} onFocus={(event) => event.target.select()} />
              <Button
                variant="secondary"
                size="icon"
                aria-label="Copy invitation link"
                onClick={() => navigator.clipboard?.writeText(issuedLink)}
              >
                <Copy size={16} aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
