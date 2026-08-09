import { withApi } from '@/server/api.ts'
import { ApiError } from '@/server/errors.ts'
import { parseOrThrow, parseSearchParams } from '@/server/validate.ts'
import { contentDisposition, exportFormatSchema, renderExport } from '@/server/exporters/index.ts'
import {
  buildExport,
  EXPORT_DATASETS,
  exportQuerySchema,
  type ExportDataset,
} from '@/server/services/exports.ts'

type Params = { orgSlug: string; conferenceId: string; dataset: string }

/**
 * A file download, so a `GET` — which is what lets a plain link do it and means
 * the browser's own download UI handles progress, cancellation and the save
 * dialog rather than a spinner someone had to write.
 *
 * `GET` and audited, which reads like a contradiction with the rest of the
 * product. It is not: this is the route that takes three hundred delegates'
 * names, emails and phone numbers off the server, and "who exported the
 * delegate list, and when" is the single audit question most likely to be asked
 * in anger.
 */
export const GET = withApi<Params>(
  async ({ request, params, ctx }) => {
    const url = new URL(request.url)

    if (!(EXPORT_DATASETS as readonly string[]).includes(params.dataset)) {
      throw ApiError.notFound('Not found')
    }
    const dataset = params.dataset as ExportDataset

    const format = parseOrThrow(exportFormatSchema, url.searchParams.get('format') ?? 'csv')
    const query = parseSearchParams(url, exportQuerySchema)

    const table = await buildExport(ctx, dataset, { day: query.day })
    const file = renderExport(table, format)

    return new Response(new Uint8Array(file.body), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': contentDisposition(file.filename),
        'Content-Length': String(file.body.byteLength),
        // Never cached. An export is a snapshot of personal data and a shared
        // cache holding one is the same mistake as a shared cache holding the
        // page it came from.
        'Cache-Control': 'no-store',
      },
    })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'export.download' },
)
