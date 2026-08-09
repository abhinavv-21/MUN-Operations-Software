import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge.tsx'
import { ConferenceNav } from '@/components/layout/ConferenceNav.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { getConference } from '@/server/services/conferences.ts'

type Params = { orgSlug: string; conferenceId: string }

const STATUS_TONE = {
  DRAFT: 'neutral',
  OPEN: 'success',
  CLOSED: 'warning',
  ARCHIVED: 'neutral',
} as const

/**
 * The conference shell.
 *
 * `pageCtx` resolves the conference against the caller's organisation here,
 * once, before any child page renders — so a conference id pasted from another
 * organisation reaches Next's 404 rather than a section of this one. Every
 * child still resolves it again for its own data, which is the cost of Server
 * Components not sharing a context, and is one indexed lookup.
 */
export default async function ConferenceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<Params>
}) {
  const { orgSlug, conferenceId } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug, conferenceId })
  const conference = await getConference(ctx, conferenceId)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/app/${orgSlug}/conferences`}
            className="text-label uppercase text-ink-secondary hover:text-ink"
          >
            Conferences
          </Link>
          <span className="text-ink-tertiary" aria-hidden>
            /
          </span>
          <span className="truncate font-heading text-h3 text-ink">{conference.name}</span>
        </div>
        <Badge tone={STATUS_TONE[conference.status]}>{conference.status.toLowerCase()}</Badge>
      </div>

      <ConferenceNav
        orgSlug={orgSlug}
        conferenceId={conferenceId}
        isAdmin={ctx.conferenceRole === 'ADMIN'}
      />

      {children}
    </>
  )
}
