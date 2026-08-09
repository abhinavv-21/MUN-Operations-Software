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
import { cn } from '@/lib/utils.ts'
import { invalidateConferenceDay } from '@/lib/invalidation.ts'
import { sendOrQueue } from '@/lib/offline/queue.ts'
import { useOfflineQueue } from '@/lib/offline/use-offline-queue.ts'
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

  /**
   * Marks this device has made but not yet seen come back from the server.
   *
   * Written the moment the button is pressed, not when the request resolves.
   * This is the most-pressed control in the product and it is pressed on one bar
   * of signal: without it, the operator taps "In", nothing changes for three
   * seconds, and they tap again or walk away unsure.
   */
  const [queued, setQueued] = useState<Record<string, Status>>({})

  const { lastFlushAt } = useOfflineQueue()

  const filters = { day, search: search || undefined, committeeId: committeeId || undefined }

  const data = useQuery({
    /*
      `lastFlushAt` is in the key on purpose.

      The queue drains in a module that knows nothing about React, so when a
      check-in made offline finally lands there is otherwise nothing to tell this
      screen. Putting the timestamp in the key makes the refetch fall out of
      React Query's own machinery — no effect, no subscription, and no `setState`
      inside `useEffect`, which this codebase lints against.
    */
    queryKey: queryKeys.attendance(conferenceId, { ...filters, flushed: lastFlushAt }),
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
        /*
          The time the mark was made, not the time it syncs.

          A check-in queued at 08:47 and flushed at 09:35 was being written with
          `markedAt` 09:35, and the audit row said the same. Attendance is the
          record of who was where and when; that column is the one thing it
          exists for, and the screen promises marks are "saved on this device and
          sent when it returns" — true about the data and quietly false about the
          time.
        */
        markedAt: new Date().toISOString(),
      }),
    // Optimistic, and before the request rather than after it.
    onMutate: (input) => setQueued((current) => ({ ...current, [input.delegateId]: input.status })),
    onError: (_error, input) =>
      setQueued((current) => {
        if (!(input.delegateId in current)) return current
        const rest = { ...current }
        delete rest[input.delegateId]
        return rest
      }),
    onSuccess: (outcome) => {
      // Sent straight through: refetch so the row becomes server truth. Queued
      // instead: leave the optimistic mark, and the reconciliation below clears
      // it when the real row arrives.
      if (outcome.sent) invalidateConferenceDay(client, conferenceId)
    },
  })

  /**
   * Reconciliation, by derivation rather than by effect.
   *
   * A queued mark is "still waiting" only until a server row agrees with it.
   * Comparing the two at render means the pending marker clears itself the
   * moment the refetch lands, with no timer, no effect and no state to reset —
   * and it cannot get stuck, which is what the previous version did for the rest
   * of the conference.
   */
  const pendingMark = (row: Row): Status | null => {
    const mark = queued[row.id]
    if (!mark) return null
    return row.attendance?.status === mark ? null : mark
  }

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
      render: (row) => row.schoolName ?? <span className="text-ink-secondary">—</span>,
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
        const waiting = pendingMark(row)
        const status = waiting ?? row.attendance?.status
        if (!status) return <span className="text-body-sm text-ink-secondary">Not marked</span>
        return (
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[status]}>{status.toLowerCase()}</Badge>
            {waiting ? (
              <span className="text-body-sm text-ink-secondary">waiting to send</span>
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'actions',
      header: 'Mark',
      // Right-aligned buttons want a right-aligned header.
      align: 'right' as const,
      render: (row) => {
        const waiting = pendingMark(row)
        const current = waiting ?? row.attendance?.status
        return (
          <div className="flex items-center justify-end gap-1">
            {(['PRESENT', 'LATE', 'ABSENT'] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={current === status ? 'primary' : 'ghost'}
                /*
                  `aria-pressed`, because the only other signal that this is the
                  current mark is the fill. A screen reader otherwise hears three
                  identical buttons, and so does anybody reading a phone at an
                  angle in a bright corridor.
                */
                aria-pressed={current === status}
                aria-label={`Mark ${row.fullName} ${status.toLowerCase()}`}
                data-testid={`mark-${status.toLowerCase()}`}
                onClick={() => checkIn.mutate({ delegateId: row.id, status })}
              >
                {status === 'PRESENT' ? 'In' : status === 'LATE' ? 'Late' : 'Absent'}
              </Button>
            ))}
            {/*
              The pending marker lives in the Mark column, which is always
              visible. It used to live in Status, which is `secondary` and
              therefore hidden below md — so on the phone at the registration
              desk, the one device this screen is for, nothing distinguished
              "saved" from "sitting in IndexedDB".
            */}
            <span
              aria-hidden
              className={cn(
                'ml-1 size-1.5 shrink-0 rounded-pill bg-warning transition-opacity duration-micro',
                waiting ? 'opacity-100' : 'opacity-0',
              )}
            />
            {waiting ? <span className="sr-only">waiting to send</span> : null}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {checkIn.error ? (
        <ErrorState
          title="That did not save"
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
              intent="progress"
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
