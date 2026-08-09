import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { updateLogisticsRequest, updateLogisticsSchema } from '@/server/services/logistics.ts'

type Params = { orgSlug: string; conferenceId: string; requestId: string }

export const PATCH = withApi<Params>(
  async ({ request, params, ctx }) => {
    const input = await parseJsonBody(request, updateLogisticsSchema)
    return json({ request: await updateLogisticsRequest(ctx, params.requestId, input) })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'logistics.update' },
)
