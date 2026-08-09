'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Users, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { CapacityMeter, Card, CardHeader } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { invalidateCommittees } from '@/lib/invalidation.ts'
import { queryKeys } from '@/lib/query-keys.ts'

interface Delegate {
  id: string
  fullName: string
  email: string
  schoolName: string | null
  assignment: { id: string; country: string; committee: { id: string; code: string } } | null
}

interface CommitteeCapacity {
  id: string
  code: string
  name: string
  seats: number | null
  filled: number
  matrixSize: number
}

interface MatrixSummary {
  created: number
  removed: number
  unknownCommittees: string[]
  message: string
}

export function DelegatesClient({
  orgSlug,
  conferenceId,
  canEdit,
}: {
  orgSlug: string
  conferenceId: string
  canEdit: boolean
}) {
  const client = useQueryClient()
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}`

  const [search, setSearch] = useState('')
  const [allocation, setAllocation] = useState<'any' | 'allocated' | 'unallocated'>('any')
  const [allocating, setAllocating] = useState<Delegate | null>(null)
  const [committeeId, setCommitteeId] = useState('')
  const [country, setCountry] = useState('')
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [matrixCsv, setMatrixCsv] = useState('')
  const [matrixSummary, setMatrixSummary] = useState<MatrixSummary | null>(null)

  const filters = { search: search || undefined, allocation }

  const data = useQuery({
    queryKey: [...queryKeys.conf(conferenceId), 'delegates', filters],
    queryFn: () => {
      const query = new URLSearchParams({ allocation })
      if (search) query.set('search', search)
      return apiFetch<{ delegates: Delegate[]; committees: CommitteeCapacity[] }>(
        `${base}/delegates?${query}`,
      )
    },
    // Typing in the search box would otherwise blank the table on every
    // keystroke.
    placeholderData: (previous) => previous,
  })

  /** What is still free in the chosen committee. Empty means unconstrained. */
  const free = useQuery({
    queryKey: [...queryKeys.conf(conferenceId), 'available', committeeId],
    queryFn: () =>
      apiFetch<{ countries: { country: string; seats: number }[] }>(
        `${base}/committees/${committeeId}/available-countries`,
      ).then((body) => body.countries),
    enabled: committeeId !== '',
  })

  const refresh = () => invalidateCommittees(client, orgSlug, conferenceId)

  const allocate = useMutation({
    mutationFn: (input: { delegateId: string; committeeId: string; country: string }) =>
      apiFetch(`${base}/allocations`, { method: 'POST', body: input }),
    onSuccess: () => {
      refresh()
      setAllocating(null)
      setCountry('')
    },
  })

  const unallocate = useMutation({
    mutationFn: (delegateId: string) =>
      apiFetch(`${base}/allocations/${delegateId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })

  const importMatrix = useMutation({
    mutationFn: (csv: string) =>
      apiFetch<MatrixSummary>(`${base}/matrix/import`, {
        method: 'POST',
        body: { csv, mode: 'replace' },
      }),
    onSuccess: (result) => {
      setMatrixSummary(result)
      setMatrixCsv('')
      refresh()
    },
  })

  const mutationError = allocate.error ?? unallocate.error ?? importMatrix.error
  const committees = data.data?.committees ?? []

  const columns: Column<Delegate>[] = [
    {
      key: 'delegate',
      header: 'Delegate',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{row.fullName}</p>
          <p className="truncate text-body-sm text-ink-secondary">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'school',
      header: 'School',
      secondary: true,
      render: (row) => row.schoolName ?? <span className="text-ink-tertiary">—</span>,
    },
    {
      key: 'allocation',
      header: 'Allocation',
      render: (row) =>
        row.assignment ? (
          <div className="flex items-center gap-2">
            <Badge tone="success">{row.assignment.committee.code}</Badge>
            <span className="text-body text-ink">{row.assignment.country}</span>
          </div>
        ) : (
          <Badge tone="warning">Unallocated</Badge>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => {
        if (!canEdit) return null
        return (
          <div className="flex justify-end gap-1">
            <Button
              variant={row.assignment ? 'ghost' : 'primary'}
              size="sm"
              onClick={() => {
                setAllocating(row)
                setCommitteeId(row.assignment?.committee.id ?? '')
                setCountry(row.assignment?.country ?? '')
              }}
            >
              {row.assignment ? 'Move' : 'Allocate'}
            </Button>
            {row.assignment ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove allocation for ${row.fullName}`}
                onClick={() => unallocate.mutate(row.id)}
              >
                <X size={16} aria-hidden />
              </Button>
            ) : null}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {mutationError ? (
        <ErrorState
          message={errorMessage(mutationError)}
          offline={mutationError instanceof ApiError && mutationError.isOffline}
        />
      ) : null}

      {committees.length > 0 ? (
        <Card>
          <CardHeader
            title="Committees"
            description="A committee with no matrix accepts any country."
            actions={
              canEdit ? (
                <Button variant="secondary" onClick={() => setMatrixOpen(true)}>
                  <Upload size={16} aria-hidden />
                  Import matrix
                </Button>
              ) : undefined
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {committees.map((committee) => (
              <div key={committee.id}>
                {committee.seats !== null ? (
                  <CapacityMeter
                    filled={committee.filled}
                    total={committee.seats}
                    label={committee.code}
                  />
                ) : (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-body-sm text-ink-secondary">{committee.code}</span>
                    <span className="font-mono text-data tabular-nums text-ink-secondary">
                      {committee.filled} allocated
                    </span>
                  </div>
                )}
                <p className="mt-1 text-body-sm text-ink-tertiary">
                  {committee.matrixSize === 0
                    ? 'No matrix — any country'
                    : `${committee.matrixSize} countries in the matrix`}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-0 md:p-0">
        <div className="p-5 pb-0 md:p-6 md:pb-0">
          <CardHeader title="Delegates" description="Approved applicants, and where they sit." />
          <div className="mb-4 flex flex-wrap gap-3">
            <Input
              aria-label="Search delegates"
              placeholder="Name, email or school"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-1">
              {(['any', 'unallocated', 'allocated'] as const).map((value) => (
                <Button
                  key={value}
                  variant={allocation === value ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setAllocation(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {data.isPending ? (
          <SkeletonRows rows={6} columns={4} />
        ) : (
          <DataTable
            caption="Delegates in this conference"
            columns={columns}
            rows={data.data?.delegates ?? []}
            rowKey={(row) => row.id}
            className="rounded-none border-0 border-t border-edge"
            empty={
              <EmptyState
                icon={Users}
                title={search ? 'Nothing matches' : 'No delegates yet'}
                description={
                  search
                    ? 'Try a different search.'
                    : 'Delegates appear here when you approve an application.'
                }
              />
            }
          />
        )}
      </Card>

      <Modal
        open={allocating !== null}
        onOpenChange={(open) => {
          if (!open) setAllocating(null)
        }}
        title={allocating ? `Allocate ${allocating.fullName}` : 'Allocate'}
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setAllocating(null)}>
              Cancel
            </Button>
            <Button
              loading={allocate.isPending}
              disabled={committeeId === '' || country.trim() === ''}
              onClick={() =>
                allocating &&
                allocate.mutate({ delegateId: allocating.id, committeeId, country: country.trim() })
              }
            >
              Allocate
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
                  setCountry('')
                }}
              >
                <option value="">Choose a committee</option>
                {committees.map((committee) => (
                  <option
                    key={committee.id}
                    value={committee.id}
                    disabled={committee.seats !== null && committee.filled >= committee.seats}
                  >
                    {committee.code} — {committee.name}
                    {committee.seats !== null ? ` (${committee.filled}/${committee.seats})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Country"
            hint={
              committeeId === ''
                ? undefined
                : free.data && free.data.length > 0
                  ? 'Only countries still free in this committee are listed.'
                  : 'This committee has no matrix, so any country is accepted.'
            }
            required
          >
            {({ id, describedBy }) =>
              free.data && free.data.length > 0 ? (
                <Select
                  id={id}
                  value={country}
                  aria-describedby={describedBy}
                  onChange={(event) => setCountry(event.target.value)}
                >
                  <option value="">Choose a country</option>
                  {free.data.map((row) => (
                    <option key={row.country} value={row.country}>
                      {row.country}
                      {row.seats > 1 ? ` (${row.seats} delegates)` : ''}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={id}
                  value={country}
                  aria-describedby={describedBy}
                  onChange={(event) => setCountry(event.target.value)}
                  placeholder="France"
                />
              )
            }
          </Field>

          {/* The list is a convenience, not the check. Two organisers can pick
              the same country a second apart, and the server is what refuses
              the second one. */}
        </div>
      </Modal>

      <Modal
        open={matrixOpen}
        onOpenChange={(open) => {
          setMatrixOpen(open)
          if (!open) setMatrixSummary(null)
        }}
        title="Import a country matrix"
        description="One column per committee, or a Committee and Country column. Replaces the matrix of every committee the file names."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setMatrixOpen(false)}>
              Close
            </Button>
            <Button
              loading={importMatrix.isPending}
              disabled={matrixCsv.trim() === ''}
              onClick={() => importMatrix.mutate(matrixCsv)}
            >
              Import
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Matrix" hint="Add x2 after a country for a double delegation.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                rows={10}
                value={matrixCsv}
                aria-describedby={describedBy}
                onChange={(event) => setMatrixCsv(event.target.value)}
                placeholder={'UNSC,WHO\nFrance,Japan\nBrazil x2,Kenya'}
              />
            )}
          </Field>

          {matrixSummary ? (
            <div role="status" className="rounded-card border border-edge bg-accent-wash p-4">
              <p className="text-body text-ink">{matrixSummary.message}</p>
              {matrixSummary.unknownCommittees.length > 0 ? (
                <p className="mt-1 text-body-sm text-ink-secondary">
                  No committee was created for those. Add the committee first if you meant it.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
