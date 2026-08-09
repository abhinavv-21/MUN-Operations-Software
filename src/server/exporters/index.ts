/**
 * One table in, one file out.
 *
 * Every format goes through here so the `Content-Disposition` filename, the
 * content type and the extension cannot disagree — which is the bug that makes
 * a browser save `delegates.csv` containing a spreadsheet.
 */

import { z } from 'zod'
import { CSV_CONTENT_TYPE, toCsv } from './csv.ts'
import { PDF_CONTENT_TYPE, toPdf } from './pdf.ts'
import { XLSX_CONTENT_TYPE, toXlsx } from './xlsx.ts'
import { fileStem, type Table } from './table.ts'

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const
export const exportFormatSchema = z.enum(EXPORT_FORMATS)
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface RenderedExport {
  body: Buffer
  contentType: string
  filename: string
}

export function renderExport(
  table: Table,
  format: ExportFormat,
  stamp = new Date(),
): RenderedExport {
  const stem = fileStem(table.title, stamp)

  if (format === 'csv') {
    return { body: toCsv(table), contentType: CSV_CONTENT_TYPE, filename: `${stem}.csv` }
  }
  if (format === 'xlsx') {
    return { body: toXlsx(table), contentType: XLSX_CONTENT_TYPE, filename: `${stem}.xlsx` }
  }
  return { body: toPdf(table, stamp), contentType: PDF_CONTENT_TYPE, filename: `${stem}.pdf` }
}

/**
 * A `Content-Disposition` value that cannot be used to inject a header.
 *
 * The filename is derived from a conference name an organiser typed, so it is
 * user input reaching a response header. The quoted form is ASCII-only with
 * quotes and backslashes stripped; `filename*` carries the real UTF-8 name for
 * everything except very old browsers, which get the ASCII fallback rather than
 * a broken download.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export { type Table, type TableColumn, type CellValue } from './table.ts'
