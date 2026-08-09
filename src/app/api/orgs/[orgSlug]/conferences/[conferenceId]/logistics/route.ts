import { json, withApi } from '@/server/api.ts'
import { parseJsonBody, parseSearchParams } from '@/server/validate.ts'
import {
  createLogisticsRequest,
  createLogisticsSchema,
  listLogistics,
  logisticsFiltersSchema,
  logisticsSummary,
} from '@/server/services/logistics.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ request, ctx }) => {
    const filters = parseSearchParams(new URL(request.url), logisticsFiltersSchema)
    const [requests, summary] = await Promise.all([
      listLogistics(ctx, filters),
      logisticsSummary(ctx),
    ])
    return json({ requests, summary })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)

/**
 * The other write the offline queue may hold.
 *
 * A replayed request answers 201 with the original row, exactly as the public
 * registration endpoint does for a duplicate submission — the caller cannot
 * distinguish the two, which is the property that makes retrying safe.
 */
export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, createLogisticsSchema)
    const { request: created, replayed } = await createLogisticsRequest(ctx, input)
    return json({ request: created, replayed }, 201)
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'logistics.create' },
)
