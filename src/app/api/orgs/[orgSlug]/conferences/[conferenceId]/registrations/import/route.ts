import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { importCsvSchema, importRegistrationsCsv } from '@/server/services/ingest.ts'

type Params = { orgSlug: string; conferenceId: string }

export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const { csv } = await parseJsonBody(request, importCsvSchema)
    return json(await importRegistrationsCsv(ctx, csv))
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'registration.import' },
)
