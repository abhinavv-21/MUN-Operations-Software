'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award as AwardIcon, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { invalidateConferenceDay } from '@/lib/invalidation.ts'
import { queryKeys } from '@/lib/query-keys.ts'

interface AwardRow {
  id: string
  title: string
  rank: number | null
  note: string | null
  committee: { id: string; code: string; name: string }
  delegate: {
    id: string
    fullName: string
    schoolName: string | null
    assignment: { country: string } | null
  }
}

interface Delegate {
  id: string
  fullName: string
  assignment: { committee: { id: string } } | null
}

interface Committee {
  id: string
  code: string
  name: string
}

/**
 * Awards.
 *
 * Grouped by committee rather than listed flat, because the list is read out
 * committee by committee and a flat table is something someone has to re-sort
 * while standing at a microphone.
 */
export function AwardsClient({
  orgSlug,
  conferenceId,
  committees,
  suggestions,
}: {
  orgSlug: string
  conferenceId: string
  committees: Committee[]
  suggestions: readonly string[]
}) {
  const client = useQueryClient()
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}`

  const [open, setOpen] = useState(false)
  const [committeeId, setCommitteeId] = useState('')
  const [delegateId, setDelegateId] = useState('')
  const [title, setTitle] = useState(suggestions[0] ?? '')
  const [note, setNote] = useState('')

  const awards = useQuery({
    queryKey: queryKeys.awards(conferenceId),
    queryFn: () => apiFetch<{ awards: AwardRow[] }>(`${base}/awards`).then((body) => body.awards),
  })

  /*
    The delegate list is fetched filtered by committee rather than filtered in
    the browser. It is the same query the allocations screen uses, so a
    conference with nine hundred delegates does not ship all nine hundred to a
    phone to populate one dropdown.
  */
  const delegates = useQuery({
    queryKey: queryKeys.delegates(conferenceId, { committeeId, allocation: 'allocated' }),
    queryFn: () =>
      apiFetch<{ delegates: Delegate[] }>(
        `${base}/delegates?allocation=allocated&committeeId=${committeeId}`,
      ).then((body) => body.delegates),
    enabled: committeeId !== '',
  })

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/awards`, {
        method: 'POST',
        body: {
          committeeId,
          delegateId,
          title: title.trim(),
          note: note.trim() || undefined,
        },
      }),
    onSuccess: () => {
      setOpen(false)
      setDelegateId('')
      setNote('')
      invalidateConferenceDay(client, conferenceId)
    },
  })

  const remove = useMutation({
    mutationFn: (awardId: string) => apiFetch(`${base}/awards/${awardId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateConferenceDay(client, conferenceId),
  })

  const grouped = useMemo(() => {
    const byCommittee = new Map<string, { committee: AwardRow['committee']; rows: AwardRow[] }>()
    for (const award of awards.data ?? []) {
      const bucket = byCommittee.get(award.committee.id) ?? {
        committee: award.committee,
        rows: [],
      }
      bucket.rows.push(award)
      byCommittee.set(award.committee.id, bucket)
    }
    return [...byCommittee.values()]
  }, [awards.data])

  const mutationError = create.error ?? remove.error

  return (
    <div className="flex flex-col gap-6">
      {mutationError ? (
        <ErrorState
          title="That did not save"
          message={errorMessage(mutationError)}
          offline={mutationError instanceof ApiError && mutationError.isOffline}
        />
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden />
          Give an award
        </Button>
      </div>

      {awards.isPending ? (
        <SkeletonRows rows={5} columns={3} />
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={AwardIcon}
            title="No awards yet"
            description="Give the first one and it appears here, grouped by committee, in the order it is read out."
            action={<Button onClick={() => setOpen(true)}>Give an award</Button>}
          />
        </Card>
      ) : (
        grouped.map((group) => (
          <Card key={group.committee.id}>
            <CardHeader title={group.committee.code} description={group.committee.name} />
            <ul className="divide-y divide-edge">
              {group.rows.map((award) => (
                <li key={award.id} className="flex items-center gap-3 py-3">
                  <Badge tone="info">{award.title}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-ink">{award.delegate.fullName}</p>
                    <p className="truncate text-body-sm text-ink-secondary">
                      {[award.delegate.assignment?.country, award.delegate.schoolName]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${award.title} from ${award.delegate.fullName}`}
                    onClick={() => remove.mutate(award.id)}
                  >
                    <X size={16} aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Give an award"
        description="The delegate has to sit in the committee giving it."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={committeeId === '' || delegateId === '' || title.trim().length < 2}
              onClick={() => create.mutate()}
            >
              Give it
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Committee" required>
            {({ id }) => (
              <Select
                id={id}
                value={committeeId}
                onChange={(event) => {
                  setCommitteeId(event.target.value)
                  setDelegateId('')
                }}
              >
                <option value="">Choose a committee</option>
                {committees.map((committee) => (
                  <option key={committee.id} value={committee.id}>
                    {committee.code} — {committee.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Delegate"
            hint={
              committeeId === ''
                ? 'Choose a committee first.'
                : delegates.data && delegates.data.length === 0
                  ? 'Nobody is allocated to this committee yet.'
                  : undefined
            }
            required
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={delegateId}
                aria-describedby={describedBy}
                disabled={committeeId === ''}
                onChange={(event) => setDelegateId(event.target.value)}
              >
                <option value="">Choose a delegate</option>
                {(delegates.data ?? []).map((delegate) => (
                  <option key={delegate.id} value={delegate.id}>
                    {delegate.fullName}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Award" hint="Pick one of the usual names, or type your own." required>
            {({ id, describedBy }) => (
              <>
                <div className="mb-2 flex flex-wrap gap-1">
                  {suggestions.map((suggestion) => (
                    <Button
                      key={suggestion}
                      size="sm"
                      variant={title === suggestion ? 'primary' : 'ghost'}
                      onClick={() => setTitle(suggestion)}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
                <Input
                  id={id}
                  value={title}
                  aria-describedby={describedBy}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </>
            )}
          </Field>

          <Field label="Note">
            {({ id }) => (
              <Textarea
                id={id}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Read out at closing ceremony."
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  )
}
