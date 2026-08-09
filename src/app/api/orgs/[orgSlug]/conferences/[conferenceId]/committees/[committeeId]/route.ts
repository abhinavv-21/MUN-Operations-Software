import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  deleteCommittee,
  updateCommittee,
  updateCommitteeSchema,
} from '@/server/services/committees.ts'

type Params = { orgSlug: string; conferenceId: string; committeeId: string }

export const PATCH = withApi<Params>(
  async ({ request, params, ctx }) => {
    const input = await parseJsonBody(request, updateCommitteeSchema)
    return json({ committee: await updateCommittee(ctx, params.committeeId, input) })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'committee.update' },
)

export const DELETE = withApi<Params>(
  async ({ params, ctx }) => {
    await deleteCommittee(ctx, params.committeeId)
    return json({ deleted: true })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'committee.delete' },
)
