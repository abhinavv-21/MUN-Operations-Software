import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { themeSchema } from '@/lib/theme/schema.ts'
import { updateOrganizationBranding } from '@/server/services/organizations.ts'

type Params = { orgSlug: string }

/**
 * `PUT`, because branding is replaced wholesale rather than patched.
 *
 * A partial theme is a theme with holes in it, and the derivation reads all
 * four seeds together to check contrast — there is no coherent way to change
 * `primary` without re-deriving everything that sits on it.
 */
export const PUT = withApi<Params>(
  async ({ request, ctx }) => {
    // Through `parseJsonBody`, so a malformed body is a 400 about syntax and a
    // rejected colour is a 422 naming the field — the error contract, not a
    // ZodError escaping as a 500.
    const theme = await parseJsonBody(request, themeSchema)
    return json({ theme: await updateOrganizationBranding(ctx, theme) })
  },
  { orgParam: 'orgSlug', audit: 'organization.branding' },
)
