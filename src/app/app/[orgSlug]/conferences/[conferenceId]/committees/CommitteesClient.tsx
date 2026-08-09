'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gavel, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Field, Input, Textarea } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
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

  const [matrixFor, setMatrixFor] = useState<Committee | null>(null)
  const [countryText, setCountryText] = useState('')

  const committees = useQuery({
    queryKey: queryKeys.committees(conferenceId),
    queryFn: () =>
      apiFetch<{ committees: Committee[] }>(base).then((body) => body.committees),
    initialData: initialCommittees,
  })

  const create = useMutation({
    mutationFn: (input: { code: string; name: string }) =>
      apiFetch<{ committee: Committee }>(base, { method: 'POST', body: input }),
    onSuccess: () => {
      invalidateCommittees(client, orgSlug, conferenceId)
      setCreateOpen(false)
      setCode('')
      setName('')
    },
  })

  const remove = useMutation({
    mutationFn: (committeeId: string) =>
      apiFetch<{ deleted: true }>(`${base}/${committeeId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateCommittees(client, orgSlug, conferenceId),
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
    const body = await apiFetch<{ countries: { country: string; seats: number }[] }>(
      `${base}/${committee.id}/countries`,
    ).catch(() => ({ countries: [] }))
    setCountryText(
      body.countries.map((row) => (row.seats > 1 ? `${row.country} x${row.seats}` : row.country)).join('\n'),
    )
  }

  const columns: Column<Committee>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (committee) => <span className="font-mono text-data">{committee.code}</span>,
    },
    { key: 'name', header: 'Committee', render: (committee) => committee.name },
    {
      key: 'countries',
      header: 'Countries',
      numeric: true,
      secondary: true,
      render: (committee) =>
        committee.countryCount === 0 ? (
          // Zero rows is a supported state, not a missing one: the committee
          // accepts free-text countries until a matrix is set.
          <span className="text-ink-tertiary">unconstrained</span>
        ) : (
          committee.countryCount
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
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
              onClick={() => remove.mutate(committee.id)}
            >
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
        ) : null,
    },
  ]

  const mutationError = create.error ?? remove.error ?? setCountries.error

  return (
    <div className="flex flex-col gap-6">
      {mutationError ? (
        <ErrorState
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
            create.mutate({ code, name })
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
        </form>
      </Modal>

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
              onClick={() => {
                if (!matrixFor) return
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
        <Field label="Countries">
          {({ id }) => (
            <Textarea
              id={id}
              rows={12}
              value={countryText}
              onChange={(event) => setCountryText(event.target.value)}
              placeholder={'France\nJapan\nBrazil x2'}
            />
          )}
        </Field>
      </Modal>
    </div>
  )
}
