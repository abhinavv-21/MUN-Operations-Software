import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  createCommittee,
  createCommitteeSchema,
  listCommittees,
} from '@/server/services/committees.ts'

type Params = { orgSlug: string; conferenceId: string }

/**
 * `conferenceParam` is what makes a hand-edited conference id a 404 rather than
 * another organisation's committee list: createCtx resolves the conference
 * against the caller's organisation before this handler runs.
 */
export const GET = withApi<Params>(
  async ({ ctx }) => json({ committees: await listCommittees(ctx) }),
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)

export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, createCommitteeSchema)
    return json({ committee: await createCommittee(ctx, input) }, 201)
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'committee.create' },
)
