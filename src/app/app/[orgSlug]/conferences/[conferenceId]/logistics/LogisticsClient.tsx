'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { invalidateConferenceDay } from '@/lib/invalidation.ts'
import { sendOrQueue } from '@/lib/offline/queue.ts'
import { queryKeys } from '@/lib/query-keys.ts'

const CATEGORIES = [
  'EQUIPMENT',
  'STATIONERY',
  'REFRESHMENT',
  'TECHNICAL',
  'MEDICAL',
  'TRANSPORT',
  'OTHER',
] as const
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const
const PRIORITIES = ['LOW', 'NORMAL', 'URGENT'] as const

type Status = (typeof STATUSES)[number]
type Priority = (typeof PRIORITIES)[number]

interface LogisticsRow {
  id: string
  title: string
  detail: string | null
  category: string
  priority: Priority
  status: Status
  createdAt: string
  resolution: string | null
  committee: { id: string; code: string } | null
  requestedBy: { fullName: string | null; email: string } | null
  resolvedBy: { fullName: string | null; email: string } | null
}

interface Committee {
  id: string
  code: string
  name: string
}

const STATUS_TONE: Record<Status, 'info' | 'warning' | 'success' | 'neutral'> = {
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  RESOLVED: 'success',
  CANCELLED: 'neutral',
}

const PRIORITY_TONE: Record<Priority, 'neutral' | 'info' | 'danger'> = {
  LOW: 'neutral',
  NORMAL: 'info',
  URGENT: 'danger',
}

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()

/**
 * The logistics board.
 *
 * Raising a request goes through `sendOrQueue`, so it survives a basement
 * committee room with no signal. **Resolving one does not**: a resolution is an
 * edit, two runners can resolve the same request differently, and a queued
 * resolution would overwrite whichever answer arrived while the queue was
 * waiting. Resolution fails fast, as every other admin write in the product
 * does.
 */
export function LogisticsClient({
  orgSlug,
  conferenceId,
  committees,
  canResolve,
}: {
  orgSlug: string
  conferenceId: string
  committees: Committee[]
  canResolve: boolean
}) {
  const client = useQueryClient()
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}`

  const [status, setStatus] = useState<'' | Status>('')
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState<LogisticsRow | null>(null)
  const [resolution, setResolution] = useState('')
  const [queuedCount, setQueuedCount] = useState(0)

  const [form, setForm] = useState({
    title: '',
    detail: '',
    category: 'OTHER' as (typeof CATEGORIES)[number],
    priority: 'NORMAL' as Priority,
    committeeId: '',
  })

  const filters = { status: status || undefined }

  const data = useQuery({
    queryKey: queryKeys.logistics(conferenceId, filters),
    queryFn: () => {
      const query = new URLSearchParams()
      if (status) query.set('status', status)
      return apiFetch<{ requests: LogisticsRow[]; summary: Record<string, number> }>(
        `${base}/logistics?${query}`,
      )
    },
    placeholderData: (previous) => previous,
  })

  const create = useMutation({
    mutationFn: async () =>
      sendOrQueue<unknown>('logistics.create', `${base}/logistics`, {
        title: form.title.trim(),
        detail: form.detail.trim() || undefined,
        category: form.category,
        priority: form.priority,
        committeeId: form.committeeId || undefined,
        /*
          The idempotency key, minted here rather than on the server.

          It has to be decided before the request leaves, because the whole
          point is that the same value is sent again by the flush. `randomUUID`
          is available in every browser this product supports over HTTPS, and
          localhost counts as a secure context.
        */
        clientRequestId: crypto.randomUUID(),
      }),
    onSuccess: (outcome) => {
      setOpen(false)
      setForm({ title: '', detail: '', category: 'OTHER', priority: 'NORMAL', committeeId: '' })
      if (outcome.sent) {
        invalidateConferenceDay(client, conferenceId)
      } else {
        // Not on the board yet, and saying so beats a silent no-op. The pill
        // carries the running total; this is the acknowledgement for this one.
        setQueuedCount((current) => current + 1)
      }
    },
  })

  const update = useMutation({
    mutationFn: (input: { id: string; status: Status; resolution?: string }) =>
      apiFetch(`${base}/logistics/${input.id}`, {
        method: 'PATCH',
        body: { status: input.status, resolution: input.resolution },
      }),
    onSuccess: () => {
      setResolving(null)
      setResolution('')
      invalidateConferenceDay(client, conferenceId)
    },
  })

  const mutationError = create.error ?? update.error

  const columns: Column<LogisticsRow>[] = [
    {
      key: 'request',
      header: 'Request',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{row.title}</p>
          <p className="truncate text-body-sm text-ink-secondary">
            {[row.committee?.code, label(row.category)].filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => <Badge tone={PRIORITY_TONE[row.priority]}>{label(row.priority)}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="min-w-0">
          <Badge tone={STATUS_TONE[row.status]}>{label(row.status)}</Badge>
          {row.resolution ? (
            <p className="mt-1 truncate text-body-sm text-ink-secondary">{row.resolution}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'raised',
      header: 'Raised by',
      secondary: true,
      render: (row) =>
        row.requestedBy?.fullName ?? row.requestedBy?.email ?? (
          <span className="text-ink-secondary">—</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => {
        if (!canResolve) return null
        if (row.status === 'RESOLVED' || row.status === 'CANCELLED') {
          return (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update.mutate({ id: row.id, status: 'OPEN' })}
              >
                Reopen
              </Button>
            </div>
          )
        }
        return (
          <div className="flex justify-end gap-1">
            {row.status === 'OPEN' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update.mutate({ id: row.id, status: 'IN_PROGRESS' })}
              >
                Pick up
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                setResolving(row)
                setResolution('')
              }}
            >
              Resolve
            </Button>
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

      {queuedCount > 0 ? (
        <div role="status" className="rounded-card border border-warning bg-warning-wash p-4">
          <p className="text-body text-ink">
            {queuedCount} request{queuedCount === 1 ? '' : 's'} saved on this device and waiting to
            send. They will appear on the board once the connection returns.
          </p>
        </div>
      ) : null}

      <Card className="p-0 md:p-0">
        <div className="p-5 pb-0 md:p-6 md:pb-0">
          <CardHeader
            title="Requests"
            description="Anything the conference needs, and what happened about it."
            actions={
              <Button data-testid="new-logistics" onClick={() => setOpen(true)}>
                <Plus size={16} aria-hidden />
                Raise a request
              </Button>
            }
          />
          <div className="mb-4 flex flex-wrap gap-1">
            {(['', ...STATUSES] as const).map((value) => (
              <Button
                key={value || 'all'}
                size="sm"
                variant={status === value ? 'primary' : 'ghost'}
                onClick={() => setStatus(value)}
              >
                {value === '' ? 'all' : label(value)}
              </Button>
            ))}
          </div>
        </div>

        {data.isPending ? (
          <SkeletonRows rows={6} columns={5} />
        ) : (
          <DataTable
            caption="Logistics requests"
            columns={columns}
            rows={data.data?.requests ?? []}
            rowKey={(row) => row.id}
            className="rounded-none border-0 border-t border-edge"
            empty={
              <EmptyState
                icon={Wrench}
                title="Nothing outstanding"
                description="Raise a request when something is needed and it appears here for whoever is running."
                action={<Button onClick={() => setOpen(true)}>Raise a request</Button>}
              />
            }
          />
        )}
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Raise a logistics request"
        description="This one saves without a connection."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="submit-logistics"
              loading={create.isPending}
              disabled={form.title.trim().length < 3}
              onClick={() => create.mutate()}
            >
              Raise it
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="What is needed" required>
            {({ id }) => (
              <Input
                id={id}
                data-testid="logistics-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Projector in UNSC has no signal"
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value as typeof form.category })
                  }
                >
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Priority">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.priority}
                  onChange={(event) =>
                    setForm({ ...form, priority: event.target.value as Priority })
                  }
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label="Committee" hint="Leave blank for anything that belongs to no committee.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={form.committeeId}
                aria-describedby={describedBy}
                onChange={(event) => setForm({ ...form, committeeId: event.target.value })}
              >
                <option value="">No committee</option>
                {committees.map((committee) => (
                  <option key={committee.id} value={committee.id}>
                    {committee.code} — {committee.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Detail">
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                value={form.detail}
                onChange={(event) => setForm({ ...form, detail: event.target.value })}
                placeholder="Room 204, the HDMI cable is missing."
              />
            )}
          </Field>
        </div>
      </Modal>

      <Modal
        open={resolving !== null}
        onOpenChange={(next) => {
          if (!next) setResolving(null)
        }}
        title={resolving ? `Resolve — ${resolving.title}` : 'Resolve'}
        description="Say what was done. Next year's team reads this."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                resolving && update.mutate({ id: resolving.id, status: 'CANCELLED', resolution })
              }
            >
              Cancel the request
            </Button>
            <Button
              loading={update.isPending}
              disabled={resolution.trim().length < 3}
              onClick={() =>
                resolving &&
                update.mutate({ id: resolving.id, status: 'RESOLVED', resolution: resolution.trim() })
              }
            >
              Mark resolved
            </Button>
          </>
        }
      >
        <Field label="What was done" required>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="Swapped the cable from room 201."
            />
          )}
        </Field>
      </Modal>
    </div>
  )
}
