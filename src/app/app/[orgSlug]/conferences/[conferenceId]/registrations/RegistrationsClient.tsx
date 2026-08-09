'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader, Stat } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Field, Input, Textarea } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { queryKeys } from '@/lib/query-keys.ts'

interface Registration {
  id: string
  reference: string
  fullName: string
  email: string
  schoolName: string | null
  committeePreference: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  createdAt: string
}

interface ImportSummary {
  created: number
  duplicates: number
  unrecognised: string[]
  ignoredPlacementColumns: string[]
  skipped: { row: number; reason: string }[]
  message: string
}

const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral' } as const

export function RegistrationsClient({
  orgSlug,
  conferenceId,
  canReview,
}: {
  orgSlug: string
  conferenceId: string
  canReview: boolean
}) {
  const client = useQueryClient()
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}/registrations`

  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING')
  const [search, setSearch] = useState('')
  const [rejecting, setRejecting] = useState<Registration | null>(null)
  const [reason, setReason] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const filters = { status: status || undefined, search: search || undefined }

  const queue = useQuery({
    queryKey: [...queryKeys.conf(conferenceId), 'registrations', filters],
    queryFn: () => {
      const query = new URLSearchParams()
      if (status) query.set('status', status)
      if (search) query.set('search', search)
      return apiFetch<{
        registrations: Registration[]
        stats: Record<string, number>
      }>(`${base}?${query}`)
    },
    // Typing in the search box would otherwise blank the table on every
    // keystroke, which is the reference product's reason for this too.
    placeholderData: (previous) => previous,
  })

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.conf(conferenceId) })
  }

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/${id}/approve`, { method: 'POST' }),
    onSuccess: refresh,
  })

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiFetch(`${base}/${input.id}/reject`, { method: 'POST', body: { reason: input.reason } }),
    onSuccess: () => {
      refresh()
      setRejecting(null)
      setReason('')
    },
  })

  const importCsv = useMutation({
    mutationFn: (text: string) =>
      apiFetch<ImportSummary>(`${base}/import`, { method: 'POST', body: { csv: text } }),
    onSuccess: (result) => {
      setSummary(result)
      setCsv('')
      refresh()
    },
  })

  const mutationError = approve.error ?? reject.error ?? importCsv.error

  const columns: Column<Registration>[] = [
    {
      key: 'applicant',
      header: 'Applicant',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{row.fullName}</p>
          <p className="truncate text-body-sm text-ink-secondary">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      secondary: true,
      render: (row) => <span className="font-mono text-data">{row.reference}</span>,
    },
    {
      key: 'school',
      header: 'School',
      secondary: true,
      render: (row) => row.schoolName ?? <span className="text-ink-secondary">—</span>,
    },
    {
      key: 'preference',
      header: 'Asked for',
      secondary: true,
      render: (row) =>
        row.committeePreference ? (
          // Shown, never acted on. Allocation happens on its own screen.
          <span className="text-ink-secondary">{row.committeePreference}</span>
        ) : (
          <span className="text-ink-secondary">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col gap-1">
          <Badge tone={STATUS_TONE[row.status]}>{row.status.toLowerCase()}</Badge>
          {row.rejectionReason ? (
            <span className="text-body-sm text-ink-secondary">{row.rejectionReason}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Decision',
      render: (row) => {
        // Omitted rather than disabled: only PENDING is reviewable, and a
        // greyed-out button is a promise the product cannot keep.
        if (!canReview || row.status !== 'PENDING') return null
        return (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              loading={approve.isPending && approve.variables === row.id}
              onClick={() => approve.mutate(row.id)}
            >
              Approve
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(row)}>
              Reject
            </Button>
          </div>
        )
      },
    },
  ]

  const stats = queue.data?.stats ?? {}

  return (
    <div className="flex flex-col gap-6">
      {mutationError ? (
        <ErrorState
          message={errorMessage(mutationError)}
          offline={mutationError instanceof ApiError && mutationError.isOffline}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Awaiting review" value={stats.PENDING ?? 0} emphasis />
        <Stat label="Approved" value={stats.APPROVED ?? 0} hint="Each one is a delegate" />
        <Stat label="Rejected" value={stats.REJECTED ?? 0} />
      </div>

      <Card className="p-0 md:p-0">
        <div className="p-5 pb-0 md:p-6 md:pb-0">
          <CardHeader
            title="Applications"
            description="Approving creates a delegate. It does not allocate a country — that is a separate decision."
            actions={
              canReview ? (
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  <Upload size={16} aria-hidden />
                  Import CSV
                </Button>
              ) : undefined
            }
          />

          <div className="mb-4 flex flex-wrap gap-3">
            <Input
              aria-label="Search applications"
              placeholder="Name, email, school or reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-1">
              {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((value) => (
                <Button
                  key={value || 'all'}
                  variant={status === value ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setStatus(value)}
                >
                  {value ? value.toLowerCase() : 'all'}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {queue.isPending ? (
          <SkeletonRows rows={5} columns={5} />
        ) : (
          <DataTable
            caption="Registrations for this conference"
            columns={columns}
            rows={queue.data?.registrations ?? []}
            rowKey={(row) => row.id}
            className="rounded-none border-0 border-t border-edge"
            empty={
              <EmptyState
                icon={Inbox}
                title={search || status ? 'Nothing matches' : 'No applications yet'}
                description={
                  search || status
                    ? 'Try a different search, or clear the filter.'
                    : 'Applications arrive from the public page or from an imported spreadsheet.'
                }
              />
            }
          />
        )}
      </Card>

      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null)
        }}
        title={rejecting ? `Reject ${rejecting.fullName}` : 'Reject'}
        description="The reason is kept with the application. Someone will ask about this decision weeks from now."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={reject.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason })}
            >
              Reject
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Applied to the wrong conference"
            />
          )}
        </Field>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setSummary(null)
        }}
        title="Import applications"
        description="Paste a CSV export from your form. Committee and country columns are read and ignored."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button
              loading={importCsv.isPending}
              disabled={csv.trim().length === 0}
              onClick={() => importCsv.mutate(csv)}
            >
              Import
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label="CSV"
            hint="The first row must be the headers your form produced. They are matched by name."
          >
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                rows={10}
                value={csv}
                aria-describedby={describedBy}
                onChange={(event) => setCsv(event.target.value)}
                placeholder={'Full name,Email address\nPriya Sharma,priya@school.test'}
              />
            )}
          </Field>

          {summary ? (
            <div role="status" className="rounded-card border border-edge bg-accent-wash p-4">
              <p className="text-body text-ink">{summary.message}</p>
              {summary.duplicates > 0 ? (
                <p className="mt-1 text-body-sm text-ink-secondary">
                  {summary.duplicates} already had a live application and were left alone.
                </p>
              ) : null}
              {summary.skipped.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1">
                  {summary.skipped.slice(0, 8).map((issue) => (
                    <li key={issue.row} className="text-body-sm text-ink-secondary">
                      Row {issue.row}: {issue.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
