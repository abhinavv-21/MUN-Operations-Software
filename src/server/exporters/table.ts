/**
 * The one shape every exporter takes.
 *
 * A dataset is assembled once, in `src/server/services/exports.ts`, and handed
 * to whichever writer the caller asked for. The alternative — a query per
 * format — is how the CSV and the PDF of the same list end up disagreeing about
 * which delegates are in it, which is the kind of bug nobody reports because
 * everybody assumes they misread one of them.
 */

export type CellValue = string | number | boolean | Date | null | undefined

export interface TableColumn {
  header: string
  /** Right-aligned in every format. Numbers only. */
  numeric?: boolean
}

export interface Table {
  /** Becomes the sheet name, the PDF heading and the download filename stem. */
  title: string
  /** One line under the heading: what this is a list of, and as of when. */
  subtitle?: string
  columns: TableColumn[]
  rows: CellValue[][]
}

/**
 * The single place a value becomes text.
 *
 * Shared by all three writers so a null renders as an empty cell everywhere
 * rather than as "null" in one of them, and a date is the same string in the
 * spreadsheet as on the printout.
 */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/** A filename stem that survives every operating system people export onto. */
export function fileStem(title: string, stamp: Date): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'export'}-${stamp.toISOString().slice(0, 10)}`
}
