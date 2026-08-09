'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { Input, Select } from '@/components/ui/Field.tsx'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States.tsx'
import { apiFetch, errorMessage } from '@/lib/api.ts'
import { queryKeys } from '@/lib/query-keys.ts'

interface Entry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  createdAt: string
  ip: string | null
  actor: { id: string; fullName: string | null; email: string } | null
  payloadBefore: unknown
  payloadAfter: unknown
}

interface Facets {
  actions: string[]
  entityTypes: string[]
  actors: { id: string; fullName: string | null; email: string }[]
}

interface Page {
  entries: Entry[]
  nextCursor: string | null
  facets: Facets
}

/** `committee.create` -> `Committee created`, without a lookup table to maintain. */
function describeAction(action: string): string {
  const [entity, verb] = action.split('.')
  if (!entity || !verb) return action
  const subject = entity.charAt(0).toUpperCase() + entity.slice(1)
  const past: Record<string, string> = {
    create: 'created',
    update: 'updated',
    remove: 'removed',
    delete: 'deleted',
    approve: 'approved',
    reject: 'rejected',
    import: 'imported',
    move: 'moved',
    checkin: 'checked in',
    replay: 'resent',
    download: 'downloaded',
    accept: 'accepted',
    invite: 'invited',
    transfer: 'transferred',
  }
  return `${subject} ${past[verb] ?? verb}`
}

function formatWhen(iso: string): string {
  const when = new Date(iso)
  return `${when.toLocaleDateString()} ${when.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`
}

/**
 * The audit-log viewer.
 *
 * Cursor paged with an explicit "load more" rather than infinite scroll: this
 * is a log someone reads while looking for one specific thing, and infinite
 * scroll makes the answer to "how far back have I looked" unanswerable.
 *
 * The payload is behind a `<details>` on each row. Expanded by default it is
 * four hundred lines of JSON between every entry, and the entry list is what
 * people are scanning.
 */
export function AuditClient({
  endpoint,
  queryScope,
  showScopeFilter = false,
}: {
  /** The API path to read from. The two views differ only in this. */
  endpoint: string
  /** Namespaces the React Query cache, so the two views cannot share a page. */
  queryScope: string
  /** Organisation view only: "everything" versus "outside a conference". */
  showScopeFilter?: boolean
}) {

  const [action, setAction] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [scope, setScope] = useState<'all' | 'organization'>('all')
  const [cursors, setCursors] = useState<string[]>([])

  const cursor = cursors.at(-1)
  const filters = { action, actorUserId, from, to, scope, cursor }

  const data = useQuery({
    queryKey: queryKeys.auditLog(queryScope, filters),
    queryFn: () => {
      const query = new URLSearchParams()
      if (action) query.set('action', action)
      if (actorUserId) query.set('actorUserId', actorUserId)
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      if (scope !== 'all') query.set('scope', scope)
      if (cursor) query.set('cursor', cursor)
      return apiFetch<Page>(`${endpoint}?${query}`)
    },
    placeholderData: (previous) => previous,
  })

  /** Any filter change starts the paging again; a cursor from the old filter is meaningless. */
  const changeFilter = (apply: () => void) => {
    apply()
    setCursors([])
  }

  const facets = data.data?.facets

  return (
    <div className="flex flex-col gap-6">
      {data.error ? <ErrorState message={errorMessage(data.error)} /> : null}

      <Card>
        <CardHeader
          title="Filters"
          description={
            showScopeFilter
              ? 'Everything written in this organisation, newest first — including conferences that have since been deleted.'
              : 'Everything written for this conference, newest first.'
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {showScopeFilter ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="audit-scope" className="text-label uppercase text-ink-secondary">
                Where
              </label>
              <Select
                id="audit-scope"
                value={scope}
                onChange={(event) =>
                  changeFilter(() => setScope(event.target.value as 'all' | 'organization'))
                }
              >
                <option value="all">Everything in this organisation</option>
                <option value="organization">Outside a conference</option>
              </Select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="audit-action" className="text-label uppercase text-ink-secondary">
              Action
            </label>
            <Select
              id="audit-action"
              value={action}
              onChange={(event) => changeFilter(() => setAction(event.target.value))}
            >
              <option value="">Every action</option>
              {(facets?.actions ?? []).map((value) => (
                <option key={value} value={value}>
                  {describeAction(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="audit-actor" className="text-label uppercase text-ink-secondary">
              Person
            </label>
            <Select
              id="audit-actor"
              value={actorUserId}
              onChange={(event) => changeFilter(() => setActorUserId(event.target.value))}
            >
              <option value="">Anyone</option>
              {(facets?.actors ?? []).map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.fullName ?? actor.email}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="audit-from" className="text-label uppercase text-ink-secondary">
              From
            </label>
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(event) => changeFilter(() => setFrom(event.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="audit-to" className="text-label uppercase text-ink-secondary">
              To
            </label>
            <Input
              id="audit-to"
              type="date"
              value={to}
              onChange={(event) => changeFilter(() => setTo(event.target.value))}
            />
          </div>
        </div>
      </Card>

      {data.isPending ? (
        <SkeletonRows rows={8} columns={3} />
      ) : (data.data?.entries.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="Nothing recorded"
            description="Either nothing has happened in this conference yet, or nothing matches these filters."
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
          <ul className="divide-y divide-edge">
            {(data.data?.entries ?? []).map((entry) => (
              <li key={entry.id} className="p-4 md:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-body text-ink">{describeAction(entry.action)}</p>
                  <p className="font-mono text-data tabular-nums text-ink-secondary">
                    {formatWhen(entry.createdAt)}
                  </p>
                </div>
                <p className="mt-1 text-body-sm text-ink-secondary">
                  {entry.actor?.fullName ?? entry.actor?.email ?? 'The system'}
                  {entry.entityId ? ` · ${entry.entityType} ${entry.entityId.slice(0, 8)}` : ` · ${entry.entityType}`}
                  {entry.ip ? ` · ${entry.ip}` : ''}
                </p>

                {entry.payloadBefore !== null || entry.payloadAfter !== null ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-body-sm text-ink-secondary hover:text-ink">
                      What changed
                    </summary>
                    <pre className="table-scroll mt-2 rounded-control bg-surface-sunken p-3 font-mono text-data text-ink-secondary">
                      {JSON.stringify(
                        { before: entry.payloadBefore, after: entry.payloadAfter },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          disabled={cursors.length === 0}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          Back
        </Button>
        <Button
          variant="secondary"
          disabled={!data.data?.nextCursor}
          onClick={() =>
            setCursors((current) =>
              data.data?.nextCursor ? [...current, data.data.nextCursor] : current,
            )
          }
        >
          Older
        </Button>
      </div>
    </div>
  )
}
