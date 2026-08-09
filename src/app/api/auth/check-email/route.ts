import { z } from 'zod'
import { json, withApi } from '@/server/api.ts'
import { clientAddress } from '@/server/ctx.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { enforceRateLimit } from '@/server/rate-limit.ts'
import { emailHasAccount } from '@/server/scope-resolution.ts'

const schema = z.object({ email: z.email().trim().toLowerCase().max(200) })

/**
 * Whether an email already has an account, for the two-step sign-in.
 *
 * This is an account-enumeration oracle and that is a deliberate, accepted
 * trade: the two-step flow is what Google and Microsoft do, it is markedly
 * better UX than making someone guess whether they are signing in or signing
 * up, and the accounts here belong to conference organisers rather than to the
 * general public.
 *
 * Rate limited hard because of it. Twenty lookups per fifteen minutes is far
 * more than a person needs and far less than a list needs, so working through
 * a school directory costs real time rather than one loop.
 */
export const POST = withApi(
  async ({ request }) => {
    const address = clientAddress(request) ?? 'unknown'
    await enforceRateLimit('check-email', address, [{ seconds: 15 * 60, limit: 20 }])

    const { email } = await parseJsonBody(request, schema)

    return json({ exists: await emailHasAccount(email) })
  },
  { auth: 'none' },
)
