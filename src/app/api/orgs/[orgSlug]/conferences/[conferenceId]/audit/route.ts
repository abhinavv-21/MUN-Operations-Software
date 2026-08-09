import { json, withApi } from '@/server/api.ts'
import { parseSearchParams } from '@/server/validate.ts'
import { auditFacets, auditFiltersSchema, listAuditLog } from '@/server/services/audit-log.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ request, ctx }) => {
    const filters = parseSearchParams(new URL(request.url), auditFiltersSchema)
    const [page, facets] = await Promise.all([listAuditLog(ctx, filters), auditFacets(ctx)])
    return json({ ...page, facets })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)
