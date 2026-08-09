import { z } from 'zod'
import { json, withApi } from '@/server/api.ts'
import { requireUser } from '@/server/ctx.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { scope } from '@/server/db.ts'
import { listMembershipsForUser } from '@/server/scope-resolution.ts'
import { createOrganization, suggestSlug } from '@/server/services/organizations.ts'
import { uuidv7 } from '@/server/ids.ts'

const schema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().min(1, 'Enter your last name').max(80),
  phone: z.string().trim().min(3, 'Enter a contact number').max(40),
  address: z.string().trim().min(3, 'Enter an address').max(300),
  organizationName: z.string().trim().max(160).optional(),
})

/**
 * Completes the profile, whichever way the person signed in.
 *
 * Google supplies a name and an email and never a phone, an address or a
 * password, so an account created through it is half a profile until this runs.
 * `profileCompletedAt` is what makes the step unskippable rather than a
 * suggestion.
 *
 * The password is not handled here at all: Supabase owns credentials, and the
 * browser sets it directly through `auth.updateUser`. Nothing about it passes
 * through our server, which is the whole point of not owning it.
 */
export const POST = withApi(async ({ request, ctx }) => {
  const user = requireUser(ctx)
  const input = await parseJsonBody(request, schema)

  const db = scope({})

  await db.user.update({
    where: { id: user.id },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: `${input.firstName} ${input.lastName}`,
      phone: input.phone,
      address: input.address,
      profileCompletedAt: new Date(),
    },
  })

  const memberships = await listMembershipsForUser(user.id)
  if (memberships.length > 0) {
    return json({ organizationSlug: memberships[0]!.organization.slug })
  }

  const name = input.organizationName?.trim()
  if (!name) return json({ organizationSlug: null })

  // A slug collision is not a dead end on someone's first screen: fall back to
  // one derived from the id, which they can rename from settings.
  const base = suggestSlug(name) || `org-${uuidv7().replace(/-/g, '').slice(0, 10)}`
  const created = await createOrganization(ctx, { name, slug: base }).catch(() =>
    createOrganization(ctx, { name, slug: `${base}-${uuidv7().slice(0, 4)}` }),
  )

  return json({ organizationSlug: created.slug })
}, { audit: 'user.complete_profile' })
