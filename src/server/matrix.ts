import { parseCsv } from './ingestion.ts'

/**
 * Parsing a country matrix.
 *
 * Two shapes, because organisers produce both:
 *
 *   **Wide** — one column per committee, countries down each column. This is
 *   what a matrix looks like when it was built in a spreadsheet by hand, which
 *   is most of them.
 *
 *   **Long** — a `committee` column and a `country` column, one row per seat.
 *   This is what a matrix looks like when it was exported from something.
 *
 * The shape is detected rather than asked for. An organiser pasting their own
 * file should not first have to classify it.
 *
 * Pure: no Prisma, no request.
 */

export interface MatrixEntry {
  committeeCode: string
  country: string
  seats: number
}

export interface MatrixParseResult {
  shape: 'wide' | 'long' | 'unknown'
  entries: MatrixEntry[]
  /**
   * Committee columns that name no committee in this conference.
   *
   * Reported and skipped. **Never created.** A typo in a header would
   * otherwise silently produce a committee nobody meant to run, and the first
   * anyone would know of it is a delegate allocated into it.
   */
  unknownCommittees: string[]
  /** Committee codes that were recognised, for the summary. */
  knownCommittees: string[]
  skipped: { row: number; reason: string }[]
}

const LONG_COMMITTEE_HEADERS = new Set(['committee', 'committee code', 'code', 'forum'])
const LONG_COUNTRY_HEADERS = new Set(['country', 'delegation', 'portfolio', 'seat'])
const LONG_SEATS_HEADERS = new Set(['seats', 'delegates', 'delegation size'])

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** `Brazil x2` and `Brazil (2)` both mean a double delegation. */
function parseCountryCell(cell: string): { country: string; seats: number } | null {
  const value = cell.trim()
  if (value === '') return null

  const suffix = /^(.*?)\s*(?:x\s*(\d+)|\((\d+)\))$/i.exec(value)
  if (suffix) {
    const seats = Number(suffix[2] ?? suffix[3])
    return { country: suffix[1]!.trim(), seats: Number.isFinite(seats) && seats > 0 ? seats : 1 }
  }

  return { country: value, seats: 1 }
}

/**
 * Parses a matrix against the committees that actually exist.
 *
 * `knownCodes` is required, not optional. This function's most important
 * property is that it refuses to invent a committee, and it cannot refuse
 * without knowing which ones are real.
 */
export function parseMatrix(text: string, knownCodes: string[]): MatrixParseResult {
  const table = parseCsv(text)
  if (table.length === 0) {
    return {
      shape: 'unknown',
      entries: [],
      unknownCommittees: [],
      knownCommittees: [],
      skipped: [{ row: 0, reason: 'The file was empty.' }],
    }
  }

  const known = new Map(knownCodes.map((code) => [normalise(code), code]))
  const headers = table[0]!.map((header) => header.trim())
  const normalised = headers.map(normalise)

  const committeeColumn = normalised.findIndex((header) => LONG_COMMITTEE_HEADERS.has(header))
  const countryColumn = normalised.findIndex((header) => LONG_COUNTRY_HEADERS.has(header))

  return committeeColumn >= 0 && countryColumn >= 0
    ? parseLong(table, normalised, committeeColumn, countryColumn, known)
    : parseWide(table, headers, normalised, known)
}

function parseLong(
  table: string[][],
  normalised: string[],
  committeeColumn: number,
  countryColumn: number,
  known: Map<string, string>,
): MatrixParseResult {
  const seatsColumn = normalised.findIndex((header) => LONG_SEATS_HEADERS.has(header))

  const entries: MatrixEntry[] = []
  const skipped: { row: number; reason: string }[] = []
  const unknown = new Set<string>()
  const usedKnown = new Set<string>()

  for (let index = 1; index < table.length; index += 1) {
    const rowNumber = index + 1
    const cells = table[index]!
    const rawCommittee = (cells[committeeColumn] ?? '').trim()
    const parsed = parseCountryCell(cells[countryColumn] ?? '')

    if (rawCommittee === '' || !parsed) {
      skipped.push({ row: rowNumber, reason: 'Missing a committee or a country.' })
      continue
    }

    const code = known.get(normalise(rawCommittee))
    if (!code) {
      unknown.add(rawCommittee)
      skipped.push({
        row: rowNumber,
        reason: `"${rawCommittee}" is not a committee in this conference. The row was skipped.`,
      })
      continue
    }

    usedKnown.add(code)
    const explicitSeats = seatsColumn >= 0 ? Number((cells[seatsColumn] ?? '').trim()) : NaN
    entries.push({
      committeeCode: code,
      country: parsed.country,
      seats: Number.isFinite(explicitSeats) && explicitSeats > 0 ? explicitSeats : parsed.seats,
    })
  }

  return {
    shape: 'long',
    entries,
    unknownCommittees: [...unknown],
    knownCommittees: [...usedKnown],
    skipped,
  }
}

function parseWide(
  table: string[][],
  headers: string[],
  normalised: string[],
  known: Map<string, string>,
): MatrixParseResult {
  const entries: MatrixEntry[] = []
  const skipped: { row: number; reason: string }[] = []
  const unknown: string[] = []
  const usedKnown = new Set<string>()

  const columns = headers.map((header, index) => ({
    header,
    index,
    code: known.get(normalised[index] ?? ''),
  }))

  for (const column of columns) {
    if (column.header === '') continue
    if (!column.code) {
      // Reported, skipped, and never created. A mistyped header would otherwise
      // become a committee nobody meant to run.
      unknown.push(column.header)
      continue
    }
    usedKnown.add(column.code)
  }

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index]!
    for (const column of columns) {
      if (!column.code) continue
      const parsed = parseCountryCell(cells[column.index] ?? '')
      if (!parsed) continue
      entries.push({ committeeCode: column.code, country: parsed.country, seats: parsed.seats })
    }
  }

  if (unknown.length > 0) {
    skipped.push({
      row: 1,
      reason: `${unknown.map((header) => `"${header}"`).join(', ')} ${
        unknown.length === 1 ? 'is not a committee' : 'are not committees'
      } in this conference. ${unknown.length === 1 ? 'That column was' : 'Those columns were'} skipped, and no committee was created.`,
    })
  }

  return {
    shape: 'wide',
    entries,
    unknownCommittees: unknown,
    knownCommittees: [...usedKnown],
    skipped,
  }
}

/** A sentence an operator can act on. */
export function describeMatrix(result: MatrixParseResult): string {
  const parts = [
    `${result.entries.length} seat${result.entries.length === 1 ? '' : 's'} across ${
      result.knownCommittees.length
    } committee${result.knownCommittees.length === 1 ? '' : 's'}`,
  ]

  if (result.unknownCommittees.length > 0) {
    parts.push(
      `${result.unknownCommittees.map((code) => `"${code}"`).join(', ')} skipped — create the committee first if you meant it`,
    )
  }

  return `${parts.join('. ')}.`
}
