import type { Metadata } from 'next'
import Link from 'next/link'
import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { PermissionDenied } from '@/components/ui/States.tsx'
import { requireOrg } from '@/server/ctx.ts'
import { isOrgAdmin } from '@/server/auth/membership.ts'
import { pageCtx } from '@/server/page-ctx.ts'
import { getOrganizationSettings } from '@/server/services/organizations.ts'
import { SettingsClient } from './SettingsClient.tsx'

export const metadata: Metadata = { title: 'Settings' }

type Params = { orgSlug: string }

/**
 * The role check runs here as well as in the service — invariant 3.
 *
 * `getOrganizationSettings` refuses a plain MEMBER itself, so this is only
 * deciding what to render. Without it the page would throw a 403 out of a
 * Server Component, which Next renders as the error boundary rather than as
 * something a person can read.
 */
export default async function OrganizationSettingsPage({ params }: { params: Promise<Params> }) {
  const { orgSlug } = await params
  const ctx = await pageCtx({ organizationSlug: orgSlug })
  const membership = requireOrg(ctx)

  if (!isOrgAdmin(membership.orgRole)) {
    return <PermissionDenied what="Organisation settings" />
  }

  const settings = await getOrganizationSettings(ctx)

  return (
    <>
      <PageHeader
        title="Settings"
        description="What this organisation is called, what it looks like, and what your plan includes."
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/app/${orgSlug}/settings/audit`}>
              <ScrollText size={16} aria-hidden />
              Audit log
            </Link>
          </Button>
        }
      />
      <SettingsClient
        orgSlug={orgSlug}
        name={settings.name}
        slug={settings.slug}
        theme={settings.theme}
        usage={settings.usage}
      />
    </>
  )
}
