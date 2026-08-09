'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Card } from '@/components/ui/Card.tsx'
import { Field, Input } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/States.tsx'
import { ApiError, apiFetch, errorMessage } from '@/lib/api.ts'
import { invalidateConferences } from '@/lib/invalidation.ts'
import { queryKeys } from '@/lib/query-keys.ts'

interface Conference {
  id: string
  slug: string
  name: string
  edition: string | null
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED'
  startsOn: string | null
  endsOn: string | null
  venue: string | null
  committeeCount: number
}

const STATUS_TONE = {
  DRAFT: 'neutral',
  OPEN: 'success',
  CLOSED: 'warning',
  ARCHIVED: 'neutral',
} as const

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function ConferencesClient({
  orgSlug,
  canCreate,
  initialConferences,
}: {
  orgSlug: string
  canCreate: boolean
  initialConferences: Conference[]
}) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const conferences = useQuery({
    queryKey: queryKeys.conferences(orgSlug),
    queryFn: () =>
      apiFetch<{ conferences: Conference[] }>(`/api/orgs/${orgSlug}/conferences`).then(
        (body) => body.conferences,
      ),
    // Server-rendered on the first paint, so the list is never empty while the
    // first fetch is in flight.
    initialData: initialConferences,
  })

  const create = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      apiFetch<{ conference: Conference }>(`/api/orgs/${orgSlug}/conferences`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      invalidateConferences(client, orgSlug)
      setOpen(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
    },
  })

  // The upgrade prompt is rendered from details.limit, not from the status
  // code. The status stays an honest 403 because there is nothing to pay yet.
  const limit = create.error instanceof ApiError ? create.error.limit : null

  return (
    <div className="flex flex-col gap-6">
      {limit ? (
        <Card className="border-warning bg-warning-wash">
          <h2 className="text-h3 text-ink">
            You are using {limit.current} of {limit.max} conferences
          </h2>
          <p className="mt-1 max-w-prose text-body-sm text-ink-secondary">
            {errorMessage(create.error)}
          </p>
          <div className="mt-4">
            <Button variant="secondary" asChild>
              <a href="mailto:support@example.com?subject=Raise%20our%20conference%20limit">
                Ask us to raise it
              </a>
            </Button>
          </div>
        </Card>
      ) : null}

      {conferences.isError ? (
        <ErrorState
          message={errorMessage(conferences.error)}
          offline={conferences.error instanceof ApiError && conferences.error.isOffline}
          onRetry={() => void conferences.refetch()}
        />
      ) : null}

      {conferences.isPending ? (
        <SkeletonCards count={3} />
      ) : conferences.data && conferences.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {conferences.data.map((conference) => (
            <li key={conference.id}>
              <Link
                href={`/app/${orgSlug}/conferences/${conference.id}`}
                className="block h-full rounded-card border border-edge bg-surface p-5 transition-colors duration-micro ease-standard hover:border-edge-strong hover:bg-surface-sunken"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-heading text-h3 text-ink">{conference.name}</span>
                  <Badge tone={STATUS_TONE[conference.status]}>
                    {conference.status.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1 text-body-sm text-ink-secondary">
                  {conference.committeeCount === 1
                    ? '1 committee'
                    : `${conference.committeeCount} committees`}
                  {conference.venue ? ` · ${conference.venue}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="No conferences yet"
            description="A conference holds its own committees, delegates and allocations."
            action={
              canCreate ? <Button onClick={() => setOpen(true)}>Create a conference</Button> : undefined
            }
          />
        </Card>
      )}

      {canCreate && conferences.data && conferences.data.length > 0 ? (
        <div>
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} aria-hidden />
            New conference
          </Button>
        </div>
      ) : null}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create a conference"
        description="You can add dates, venue and fee afterwards."
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="conference-form"
              loading={create.isPending}
              disabled={name.length < 2}
            >
              Create
            </Button>
          </>
        }
      >
        <form
          id="conference-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate({ name, slug: effectiveSlug })
          }}
        >
          <Field label="Name" required>
            {({ id }) => (
              <Input
                id={id}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="LRI MUN XI"
              />
            )}
          </Field>

          <Field label="Address" hint="Used in the public registration link.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                required
                value={effectiveSlug}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value)
                }}
                placeholder="mun-xi"
              />
            )}
          </Field>
        </form>

        {create.isError && !limit ? (
          <p role="alert" className="mt-2 text-body-sm text-danger">
            {errorMessage(create.error)}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
