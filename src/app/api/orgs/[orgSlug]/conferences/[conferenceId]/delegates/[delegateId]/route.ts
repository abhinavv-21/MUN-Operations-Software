import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { updateDelegate, updateDelegateSchema } from '@/server/services/delegates.ts'

type Params = { orgSlug: string; conferenceId: string; delegateId: string }

export const PATCH = withApi<Params>(
  async ({ request, params, ctx }) => {
    const input = await parseJsonBody(request, updateDelegateSchema)
    return json({ delegate: await updateDelegate(ctx, params.delegateId, input) })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'delegate.update' },
)
