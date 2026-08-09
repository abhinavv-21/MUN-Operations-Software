import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import {
  createOrganization,
  createOrganizationSchema,
  listMyOrganizations,
} from '@/server/services/organizations.ts'

export const GET = withApi(async ({ ctx }) => json({ organizations: await listMyOrganizations(ctx) }))

export const POST = withApi(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, createOrganizationSchema)
    return json({ organization: await createOrganization(ctx, input) }, 201)
  },
  { audit: 'organization.create' },
)
