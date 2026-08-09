import { json, withApi } from '@/server/api.ts'
import { parseJsonBody } from '@/server/validate.ts'
import { importMatrix, importMatrixSchema } from '@/server/services/allocations.ts'

type Params = { orgSlug: string; conferenceId: string }

export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const { csv, mode } = await parseJsonBody(request, importMatrixSchema)
    return json(await importMatrix(ctx, csv, mode))
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'matrix.import' },
)
