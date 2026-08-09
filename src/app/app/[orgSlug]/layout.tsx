import Link from 'next/link'
import type { ReactNode } from 'react'
import { pageCtx } from '@/server/page-ctx.ts'
import { requireOrg } from '@/server/ctx.ts'

/**
 * The organisation shell.
 *
 * A non-member reaching this gets Next's 404 page, not a 403 — `pageCtx`
 * translates the `ApiError.notFound` that `createCtx` throws when membership
 * resolution finds nothing. It renders identically to a slug that was never
 * registered, which is the point: whether `harvard` is a customer is not
 * something a stranger should be able to determine by typing it.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  const canManage = membership.orgRole === 'OWNER' || membership.canManageMembers

  return (
    <div className="shell">
      <nav className="shell-nav">
        <Link href="/app" className="muted">
          ← All organisations
        </Link>
        <strong>{membership.organizationName}</strong>
        <Link href={`/app/${orgSlug}`}>Overview</Link>
        {canManage ? <Link href={`/app/${orgSlug}/members`}>Members</Link> : null}
        <span className="grow" />
        <span className="muted">{ctx.user?.email}</span>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className="button subtle">
            Sign out
          </button>
        </form>
      </nav>
      <div className="shell-body">{children}</div>
    </div>
  )
}
