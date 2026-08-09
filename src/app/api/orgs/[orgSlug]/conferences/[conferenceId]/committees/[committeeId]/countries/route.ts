import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { listCountries, setCountries, setCountriesSchema } from '@/server/services/committees.ts'

type Params = { orgSlug: string; conferenceId: string; committeeId: string }

export const GET = withApi<Params>(
  async ({ params, ctx }) => json({ countries: await listCountries(ctx, params.committeeId) }),
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)

/** Replaces the matrix wholesale. Zero countries means unconstrained. */
export const PUT = withApi<Params>(
  async ({ request, params, ctx }) => {
    const { countries } = await parseJsonBody(request, setCountriesSchema)
    return json(await setCountries(ctx, params.committeeId, countries))
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'committee.set_countries' },
)
