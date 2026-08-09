import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { allocate, allocateSchema, listAllocations } from '@/server/services/allocations.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ ctx }) => json({ allocations: await listAllocations(ctx) }),
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)

/**
 * Allocating the same country twice answers 409, not 500.
 *
 * The unique constraint is the guarantee; the serializable transaction inside
 * the service is what makes a race arrive here as a conflict rather than a
 * crash. The error ladder turns P2002 into the 409.
 */
export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, allocateSchema)
    return json({ assignment: await allocate(ctx, input) }, 201)
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'assignment.create' },
)
