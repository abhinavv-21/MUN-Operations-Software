import { json, withApi } from '@/server/api.ts'
import { parseSearchParams } from '@/server/validate.ts'
import {
  auditFiltersSchema,
  listOrganizationAuditLog,
  organizationAuditFacets,
} from '@/server/services/audit-log.ts'

type Params = { orgSlug: string }

/**
 * The organisation-wide audit log.
 *
 * Distinct from the conference view, which is scoped to one conference and open
 * to its admins. This one is owner-and-admin only, and it is the only place a
 * deleted conference's history can be read — those rows keep their organisation
 * and lose their conference.
 */
export const GET = withApi<Params>(
  async ({ request, ctx }) => {
    const filters = parseSearchParams(new URL(request.url), auditFiltersSchema)
    const [page, facets] = await Promise.all([
      listOrganizationAuditLog(ctx, filters),
      organizationAuditFacets(ctx),
    ])
    return json({ ...page, facets })
  },
  { orgParam: 'orgSlug' },
)
