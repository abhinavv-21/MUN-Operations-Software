import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  getOrganizationSettings,
  updateOrganization,
  updateOrganizationSchema,
} from '@/server/services/organizations.ts'

type Params = { orgSlug: string }

export const GET = withApi<Params>(async ({ ctx }) => json(await getOrganizationSettings(ctx)), {
  orgParam: 'orgSlug',
})

/**
 * Renaming, and moving the organisation's address.
 *
 * A slug change moves every public registration URL the organisation has given
 * out. Allowed anyway — see `updateOrganization` — and the audit row carries
 * both values, so the old address is recoverable from the log rather than from
 * somebody's memory.
 */
export const PATCH = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, updateOrganizationSchema)
    return json({ organization: await updateOrganization(ctx, input) })
  },
  { orgParam: 'orgSlug', audit: 'organization.update' },
)
