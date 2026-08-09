'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { CapacityMeter, Card, CardHeader } from '@/components/ui/Card.tsx'
import { DataTable, type Column } from '@/components/ui/DataTable.tsx'
import { Input, Select } from '@/components/ui/Field.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { invalidateConferenceDay } from '@/lib/invalidation.ts'
import { sendOrQueue } from '@/lib/offline/queue.ts'
import { queryKeys } from '@/lib/query-keys.ts'

type Status = 'PRESENT' | 'LATE' | 'ABSENT'

interface Row {
  id: string
  fullName: string
  email: string
  schoolName: string | null
  assignment: { country: string; committee: { id: string; code: string } } | null
  attendance: { id: string; status: Status; markedAt: string; note: string | null } | null
}

interface Summary {
  day: string
  total: number
  present: number
  late: number
  absent: number
  unmarked: number
}

const STATUS_TONE: Record<Status, 'success' | 'warning' | 'danger'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
}

/** Local calendar date, not UTC. `toISOString()` here is yesterday until 05:30. */
function todayLocal(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

/**
 * The register.
 *
 * The one screen in the product that has to work with no connection, so the
 * check-in mutation is the only place besides the logistics form that calls
 * `sendOrQueue` instead of `apiFetch`. Everything else on this page — the list,
 * the summary — is a read, and a read offline simply shows what it last had.
 */
export function AttendanceClient({
  orgSlug,
  conferenceId,
}: {
  orgSlug: string
  conferenceId: string
}) {
  const client = useQueryClient()
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}`

  const [day, setDay] = useState(todayLocal)
  const [search, setSearch] = useState('')
  const [committeeId, setCommitteeId] = useState('')
  const [queued, setQueued] = useState<Record<string, Status>>({})

  const filters = { day, search: search || undefined, committeeId: committeeId || undefined }

  const data = useQuery({
    queryKey: queryKeys.attendance(conferenceId, filters),
    queryFn: () => {
      const query = new URLSearchParams({ day })
      if (search) query.set('search', search)
      if (committeeId) query.set('committeeId', committeeId)
      return apiFetch<{ delegates: Row[]; summary: Summary }>(`${base}/attendance?${query}`)
    },
    placeholderData: (previous) => previous,
  })

  const checkIn = useMutation({
    mutationFn: async (input: { delegateId: string; status: Status }) =>
      sendOrQueue<unknown>('attendance.checkin', `${base}/attendance`, {
        delegateId: input.delegateId,
        day,
        status: input.status,
      }),
    onSuccess: (outcome, input) => {
      if (outcome.sent) {
        // Landed. Drop any optimistic mark and let the refetch be the truth.
        setQueued((current) => {
          if (!(input.delegateId in current)) return current
          const rest = { ...current }
          delete rest[input.delegateId]
          return rest
        })
        invalidateConferenceDay(client, conferenceId)
        return
      }

      /*
        Queued rather than sent. The row has to show the mark immediately —
        the operator is holding a queue of delegates and cannot wait for the
        network to come back to find out whether the tap registered — but the
        server list has not changed, so this is held separately and reconciled
        when the flush lands.
      */
      setQueued((current) => ({ ...current, [input.delegateId]: input.status }))
    },
  })

  const committees = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of data.data?.delegates ?? []) {
      if (row.assignment) seen.set(row.assignment.committee.id, row.assignment.committee.code)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.data])

  const summary = data.data?.summary

  const columns: Column<Row>[] = [
    {
      key: 'delegate',
      header: 'Delegate',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{row.fullName}</p>
          <p className="truncate text-body-sm text-ink-secondary">
            {row.assignment
              ? `${row.assignment.committee.code} · ${row.assignment.country}`
              : 'Unallocated'}
          </p>
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
      key: 'status',
      header: 'Status',
      /*
        Hidden below md, and the three mark buttons are why.

        On a 390px screen the badge pushed "Absent" off the edge behind a
        horizontal scroll — on the one screen whose entire purpose is tapping
        one of those three while somebody waits at the desk. The badge is the
        only thing here that is redundant: the button for the current state is
        already filled in, so the row still says what it says.
      */
      secondary: true,
      render: (row) => {
        const pending = queued[row.id]
        const status = pending ?? row.attendance?.status
        if (!status) return <span className="text-body-sm text-ink-tertiary">Not marked</span>
        return (
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[status]}>{status.toLowerCase()}</Badge>
            {pending ? (
              <span className="text-body-sm text-ink-tertiary">waiting to send</span>
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'actions',
      header: 'Mark',
      render: (row) => {
        const current = queued[row.id] ?? row.attendance?.status
        return (
          <div className="flex justify-end gap-1">
            {(['PRESENT', 'LATE', 'ABSENT'] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={current === status ? 'primary' : 'ghost'}
                aria-label={`Mark ${row.fullName} ${status.toLowerCase()}`}
                data-testid={`mark-${status.toLowerCase()}`}
                onClick={() => checkIn.mutate({ delegateId: row.id, status })}
              >
                {status === 'PRESENT' ? 'In' : status === 'LATE' ? 'Late' : 'Absent'}
              </Button>
            ))}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {checkIn.error ? (
        <ErrorState
          message={errorMessage(checkIn.error)}
          offline={checkIn.error instanceof ApiError && checkIn.error.isOffline}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Register"
          description="Marks made without a connection are saved on this device and sent when it returns."
        />
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="attendance-day" className="text-label uppercase text-ink-secondary">
              Day
            </label>
            <Input
              id="attendance-day"
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="w-44"
            />
          </div>
          <Input
            aria-label="Search delegates"
            placeholder="Name, email or school"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-xs"
          />
          <Select
            aria-label="Filter by committee"
            value={committeeId}
            onChange={(event) => setCommitteeId(event.target.value)}
            className="max-w-48"
          >
            <option value="">Every committee</option>
            {committees.map(([id, code]) => (
              <option key={id} value={id}>
                {code}
              </option>
            ))}
          </Select>
        </div>

        {summary ? (
          <>
            <CapacityMeter
              filled={summary.present + summary.late}
              total={summary.total}
              label="Marked present"
              unit="delegates"
            />
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Present', summary.present],
                ['Late', summary.late],
                ['Absent', summary.absent],
                ['Not marked', summary.unmarked],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-label uppercase text-ink-secondary">{label}</dt>
                  <dd className="font-mono text-data tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </Card>

      {data.isPending ? (
        <SkeletonRows rows={8} columns={4} />
      ) : (
        <DataTable
          caption={`Attendance for ${day}`}
          columns={columns}
          rows={data.data?.delegates ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={ClipboardCheck}
              title={search ? 'Nothing matches' : 'Nobody to check in'}
              description={
                search
                  ? 'Try a different search.'
                  : 'Delegates appear here once an application is approved.'
              }
            />
          }
        />
      )}
    </div>
  )
}
