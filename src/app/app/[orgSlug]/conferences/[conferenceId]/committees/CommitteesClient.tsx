'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gavel, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Field, Input, Textarea } from '@/components/ui/Field.tsx'
import { SaveIndicator, type SaveState } from '@/components/ui/SaveIndicator.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { ConfirmDialog } from '@/components/app/ConfirmDialog.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { invalidateCommittees } from '@/lib/invalidation.ts'
import { queryKeys } from '@/lib/query-keys.ts'

interface Committee {
  id: string
  code: string
  name: string
  seats: number | null
  countryCount: number
}

export function CommitteesClient({
  orgSlug,
  conferenceId,
  canEdit,
  initialCommittees,
}: {
  orgSlug: string
  conferenceId: string
  canEdit: boolean
  initialCommittees: Committee[]
}) {
  const client = useQueryClient()
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}/committees`

  const [createOpen, setCreateOpen] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const [seats, setSeats] = useState('')

  const [matrixFor, setMatrixFor] = useState<Committee | null>(null)
  const [countryText, setCountryText] = useState('')
  /**
   * Whether the committee's current matrix has actually been read.
   *
   * `PUT /countries` replaces the whole list, and an empty textarea is a valid
   * instruction meaning "unconstrained". So a failed or slow fetch used to
   * present an empty box that looked exactly like a committee with no matrix,
   * and one click of Save erased a hand-built sixty-country list with no
   * confirmation and no undo. Nothing may be saved until the current list is on
   * screen.
   */
  const [matrixState, setMatrixState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [deleting, setDeleting] = useState<Committee | null>(null)

  /** Per-row save state for the inline seat editor, keyed by committee id. */
  const [seatState, setSeatState] = useState<Record<string, SaveState>>({})

  const committees = useQuery({
    queryKey: queryKeys.committees(conferenceId),
    queryFn: () =>
      apiFetch<{ committees: Committee[] }>(base).then((body) => body.committees),
    initialData: initialCommittees,
  })

  const create = useMutation({
    mutationFn: (input: { code: string; name: string; seats: number | null }) =>
      apiFetch<{ committee: Committee }>(base, { method: 'POST', body: input }),
    onSuccess: () => {
      invalidateCommittees(client, orgSlug, conferenceId)
      setCreateOpen(false)
      setCode('')
      setName('')
      setSeats('')
    },
  })

  /**
   * Inline seat editing. `updateCommittee` has existed since Stage 4 with no
   * control calling it, so a committee's capacity could only be set through the
   * API — which meant seat limits, and the whole serializable allocation
   * machinery behind them, were unreachable for anyone using the product.
   *
   * Saved on blur rather than on every keystroke: typing "15" over "5" passes
   * through "1", and a request per character would briefly set the capacity
   * below what is already allocated.
   */
  const updateSeats = useMutation({
    mutationFn: (input: { committeeId: string; seats: number | null }) =>
      apiFetch<{ committee: Committee }>(`${base}/${input.committeeId}`, {
        method: 'PATCH',
        body: { seats: input.seats },
      }),
    onMutate: (input) => setSeatState((current) => ({ ...current, [input.committeeId]: 'saving' })),
    onSuccess: (_result, input) => {
      setSeatState((current) => ({ ...current, [input.committeeId]: 'saved' }))
      invalidateCommittees(client, orgSlug, conferenceId)
    },
    onError: (_error, input) =>
      setSeatState((current) => ({ ...current, [input.committeeId]: 'error' })),
  })

  const remove = useMutation({
    mutationFn: (committeeId: string) =>
      apiFetch<{ deleted: true }>(`${base}/${committeeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null)
      invalidateCommittees(client, orgSlug, conferenceId)
    },
  })

  const setCountries = useMutation({
    mutationFn: (input: { committeeId: string; countries: { country: string; seats: number }[] }) =>
      apiFetch<{ count: number }>(`${base}/${input.committeeId}/countries`, {
        method: 'PUT',
        body: { countries: input.countries },
      }),
    onSuccess: () => {
      invalidateCommittees(client, orgSlug, conferenceId)
      setMatrixFor(null)
      setCountryText('')
    },
  })

  async function openMatrix(committee: Committee) {
    setMatrixFor(committee)
    setCountryText('')
    setMatrixState('loading')

    try {
      const body = await apiFetch<{ countries: { country: string; seats: number }[] }>(
        `${base}/${committee.id}/countries`,
      )
      setCountryText(
        body.countries
          .map((row) => (row.seats > 1 ? `${row.country} x${row.seats}` : row.country))
          .join('\n'),
      )
      setMatrixState('ready')
    } catch {
      // Deliberately not `.catch(() => ({ countries: [] }))`. Swallowing the
      // failure into an empty list is what made this destructive.
      setMatrixState('failed')
    }
  }

  const columns: Column<Committee>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (committee) => <span className="font-mono text-data">{committee.code}</span>,
    },
    { key: 'name', header: 'Committee', render: (committee) => committee.name },
    {
      key: 'seats',
      header: 'Seats',
      render: (committee) =>
        canEdit ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Seats in ${committee.code}`}
              defaultValue={committee.seats ?? ''}
              inputMode="numeric"
              placeholder="unlimited"
              className="w-28"
              onBlur={(event) => {
                const raw = event.target.value.trim()
                const next = raw === '' ? null : Number(raw)
                if (next !== null && (!Number.isInteger(next) || next < 1)) return
                if (next === committee.seats) return
                updateSeats.mutate({ committeeId: committee.id, seats: next })
              }}
            />
            <span aria-live="polite">
              <SaveIndicator state={seatState[committee.id] ?? 'idle'} />
            </span>
          </div>
        ) : committee.seats === null ? (
          <span className="text-ink-secondary">unlimited</span>
        ) : (
          <span className="font-mono text-data tabular-nums">{committee.seats}</span>
        ),
    },
    {
      key: 'countries',
      header: 'Countries',
      numeric: true,
      secondary: true,
      render: (committee) =>
        committee.countryCount === 0 ? (
          // Zero rows is a supported state, not a missing one: the committee
          // accepts free-text countries until a matrix is set.
          <span className="text-ink-secondary">unconstrained</span>
        ) : (
          committee.countryCount
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      // Right-aligned buttons want a right-aligned header.
      align: 'right' as const,
      render: (committee) =>
        canEdit ? (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => void openMatrix(committee)}>
              Matrix
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${committee.code}`}
              onClick={() => setDeleting(committee)}
            >
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
        ) : null,
    },
  ]

  const mutationError = create.error ?? remove.error ?? setCountries.error ?? updateSeats.error

  return (
    <div className="flex flex-col gap-6">
      {mutationError ? (
        <ErrorState
          title="That did not save"
          message={errorMessage(mutationError)}
          offline={mutationError instanceof ApiError && mutationError.isOffline}
        />
      ) : null}

      <Card className="p-0 md:p-0">
        <div className="p-5 pb-0 md:p-6 md:pb-0">
          <CardHeader
            title="Committees"
            description="A committee with no country matrix accepts any country."
            actions={
              canEdit ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus size={16} aria-hidden />
                  Add committee
                </Button>
              ) : undefined
            }
          />
        </div>

        {committees.isPending ? (
          <SkeletonRows rows={4} columns={4} />
        ) : (
          <DataTable
            caption="Committees in this conference"
            columns={columns}
            rows={committees.data ?? []}
            rowKey={(committee) => committee.id}
            className="rounded-none border-0 border-t border-edge"
            empty={
              <EmptyState
                icon={Gavel}
                title="No committees yet"
                description="Add the councils and assemblies this conference will run."
                action={
                  canEdit ? <Button onClick={() => setCreateOpen(true)}>Add committee</Button> : undefined
                }
              />
            }
          />
        )}
      </Card>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Add a committee"
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="committee-form"
              loading={create.isPending}
              disabled={code.length < 2 || name.length < 2}
            >
              Add
            </Button>
          </>
        }
      >
        <form
          id="committee-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const parsed = seats.trim() === '' ? null : Number(seats.trim())
            create.mutate({
              code,
              name,
              seats: parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null,
            })
          }}
        >
          <Field label="Code" hint="Short, and how delegates will refer to it." required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                required
                value={code}
                aria-describedby={describedBy}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="UNSC"
              />
            )}
          </Field>

          <Field label="Full name" required>
            {({ id }) => (
              <Input
                id={id}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="United Nations Security Council"
              />
            )}
          </Field>

          <Field
            label="Seats"
            hint="Leave blank for no limit. Capacity is enforced when a delegate is allocated, not here."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                inputMode="numeric"
                value={seats}
                aria-describedby={describedBy}
                onChange={(event) => setSeats(event.target.value)}
                placeholder="15"
              />
            )}
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={deleting ? `Delete ${deleting.code}?` : 'Delete committee'}
        description={
          deleting
            ? `${deleting.name} and everything filed under it will be removed.`
            : ''
        }
        consequence={
          deleting
            ? `Its country matrix${
                deleting.countryCount > 0 ? ` of ${deleting.countryCount} countries` : ''
              }, every allocation in it and every award given in it go too. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete committee"
        // Typed, because this is the one row action that cascades. The trash
        // icon sits four pixels from "Matrix".
        confirmPhrase={deleting?.code}
        busy={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />

      <Modal
        open={matrixFor !== null}
        onOpenChange={(open) => {
          if (!open) setMatrixFor(null)
        }}
        title={matrixFor ? `Country matrix — ${matrixFor.code}` : 'Country matrix'}
        description="One country per line. Add x2 for a double delegation. An empty list leaves the committee unconstrained."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setMatrixFor(null)}>
              Cancel
            </Button>
            <Button
              loading={setCountries.isPending}
              // Nothing may replace a matrix that was never read.
              disabled={matrixState !== 'ready'}
              onClick={() => {
                if (!matrixFor || matrixState !== 'ready') return
                const countries = countryText
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const match = /^(.*?)\s*x\s*(\d+)$/i.exec(line)
                    return match
                      ? { country: match[1]!.trim(), seats: Number(match[2]) }
                      : { country: line, seats: 1 }
                  })
                setCountries.mutate({ committeeId: matrixFor.id, countries })
              }}
            >
              Save matrix
            </Button>
          </>
        }
      >
        {matrixState === 'failed' ? (
          <ErrorState
            message="The current matrix could not be read, so it cannot be replaced from here. Check your connection and reopen this."
            onRetry={() => matrixFor && void openMatrix(matrixFor)}
          />
        ) : (
          <Field
            label="Countries"
            hint={
              matrixState === 'loading'
                ? 'Reading the current matrix…'
                : 'Saving replaces the whole list. An empty list leaves the committee unconstrained.'
            }
          >
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                rows={12}
                value={countryText}
                aria-describedby={describedBy}
                aria-busy={matrixState === 'loading'}
                disabled={matrixState === 'loading'}
                onChange={(event) => setCountryText(event.target.value)}
                placeholder={'France\nJapan\nBrazil x2'}
              />
            )}
          </Field>
        )}
      </Modal>
    </div>
  )
}
