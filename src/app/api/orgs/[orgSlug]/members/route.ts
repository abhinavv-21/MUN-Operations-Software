import { json, withApi } from '@/server/api.ts'
import { listMembers } from '@/server/services/members.ts'

type Params = { orgSlug: string }

/**
 * A non-member gets 404 here, not 403, and not an empty list.
 *
 * `orgParam` is what arranges that: `createCtx` resolves membership before the
 * handler runs and throws `notFound` when there is none, so the handler below
 * never executes for someone outside the organisation.
 */
export const GET = withApi<Params>(async ({ ctx }) => json({ members: await listMembers(ctx) }), {
  orgParam: 'orgSlug',
})
