import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { AppShell } from '@/components/layout/AppShell.tsx'
import { OfflineRuntime } from '@/components/offline/OfflineRuntime.tsx'
import { ThemeStyle } from '@/components/ThemeStyle.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { isOrgAdmin } from '@/server/auth/membership.ts'
import { pageCtx, requireCompletedProfile } from '@/server/page-ctx.ts'
import { getOrganizationThemeCss } from '@/server/services/theme.ts'

/**
 * The organisation shell.
 *
 * A non-member reaching this gets Next's 404 page, not a 403 — `pageCtx`
 * translates the `ApiError.notFound` that `createCtx` throws when membership
 * resolution finds nothing. It renders identically to a slug that was never
 * registered, which is the point: whether `harvard` is a customer is not
 * something a stranger should determine by typing it.
 *
 * The theme block is rendered here, after the root layout's default, so it
 * wins on source order. Both are in the document before any content, so there
 * is no flash of the wrong palette — with JavaScript disabled entirely.
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
  requireCompletedProfile(ctx)
  const membership = requireOrg(ctx)

  const [themeCss, nonce] = await Promise.all([
    getOrganizationThemeCss(membership.organizationId),
    headers().then((all) => all.get('x-nonce') ?? undefined),
  ])
  const canManageMembers = membership.orgRole === 'OWNER' || membership.canManageMembers
  const orgAdmin = isOrgAdmin(membership.orgRole)

  return (
    <>
      <ThemeStyle css={themeCss} nonce={nonce} />
      <AppShell
        orgSlug={orgSlug}
        organizationName={membership.organizationName}
        userEmail={ctx.user?.email ?? ''}
        canManageMembers={canManageMembers}
        isOrgAdmin={orgAdmin}
      >
        {children}
      </AppShell>
      {/* Mounted inside the organisation, not at the root: the queue only ever
          holds conference writes, and the sign-in and public registration pages
          have nothing to flush. */}
      <OfflineRuntime />
    </>
  )
}
