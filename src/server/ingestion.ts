/**
 * Turning someone else's spreadsheet into registrations.
 *
 * This module is why the product does not need a form builder. Organisers will
 * ask for one in week one; the answer is that **their Google Form already is
 * their custom form**, and header aliasing is what makes that true. A form
 * builder would mean a schema we cannot validate, export or render, and a
 * `customFields` JSON blob is the same problem with extra steps.
 *
 * Pure: no Prisma, no request, no network.
 */

export interface IngestRow {
  fullName: string
  email: string
  phone: string | null
  schoolName: string | null
  grade: string | null
  committeePreference: string | null
  committeePreference2: string | null
  dietaryNotes: string | null
  accessibilityNotes: string | null
}

/** Header aliases, so an operator can paste a Google Form export unchanged. */
const HEADER_ALIASES: Record<string, keyof IngestRow> = {
  'full name': 'fullName',
  name: 'fullName',
  'delegate name': 'fullName',
  'your name': 'fullName',

  'email address': 'email',
  email: 'email',
  'e-mail': 'email',
  'email id': 'email',

  'phone number': 'phone',
  phone: 'phone',
  mobile: 'phone',
  contact: 'phone',
  'contact number': 'phone',

  school: 'schoolName',
  'school name': 'schoolName',
  institution: 'schoolName',
  'school / institution': 'schoolName',

  grade: 'grade',
  class: 'grade',
  year: 'grade',
  'academic level': 'grade',
  level: 'grade',

  'committee preference': 'committeePreference',
  preference: 'committeePreference',
  'preferred committee': 'committeePreference',
  'committee choice': 'committeePreference',
  'first preference': 'committeePreference',
  'committee preference 1': 'committeePreference',

  'second preference': 'committeePreference2',
  'committee preference 2': 'committeePreference2',

  'dietary notes': 'dietaryNotes',
  dietary: 'dietaryNotes',
  'dietary requirements': 'dietaryNotes',
  'food requirements': 'dietaryNotes',

  'accessibility notes': 'accessibilityNotes',
  accessibility: 'accessibilityNotes',
  'accessibility requirements': 'accessibilityNotes',
}

/**
 * Headers that describe a placement rather than an application.
 *
 * Read, reported, and never acted on. A bare `committee` heading is
 * deliberately **not** an alias of `committee preference`: in an organiser's
 * own sheet, a column called "Committee" is overwhelmingly where they have
 * already written the allocation by hand. Importing that as a preference would
 * be wrong; importing it as an allocation would be worse.
 */
const PLACEMENT_HEADERS = new Set([
  'committee',
  'country',
  'allocation',
  'allocated committee',
  'allocated country',
  'portfolio',
  'delegation',
  'seat',
])

function normaliseHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/\s+/g, ' ')
  return HEADER_ALIASES[key] ?? key
}

/**
 * A CSV parser that copes with quoted fields, embedded commas and newlines.
 *
 * Hand-written rather than a dependency: the input is a spreadsheet export, the
 * grammar is one page, and a parser is easier to reason about than a library's
 * options matrix when a row fails.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // A BOM from Excel would otherwise become part of the first header.
  const input = text.replace(/^﻿/, '')

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

export interface IngestIssue {
  row: number
  reason: string
}

export interface IngestResult {
  rows: IngestRow[]
  /** Headers understood, in the order they appeared. */
  recognised: string[]
  /** Headers present but not understood. Reported, not fatal. */
  unrecognised: string[]
  /**
   * Placement columns found and deliberately not acted on.
   *
   * Surfaced to the operator verbatim, because silence here reads as "the
   * import handled my allocations" — and it did not.
   */
  ignoredPlacementColumns: string[]
  skipped: IngestIssue[]
}

const REQUIRED: (keyof IngestRow)[] = ['fullName', 'email']

/**
 * Parses a spreadsheet into rows ready to become registrations.
 *
 * Never allocates. Committee and country columns are parsed, ignored, and
 * reported back as ignored — the guarantee the reference product states and
 * this product keeps.
 */
export function ingestCsv(text: string): IngestResult {
  const table = parseCsv(text)
  if (table.length === 0) {
    return {
      rows: [],
      recognised: [],
      unrecognised: [],
      ignoredPlacementColumns: [],
      skipped: [{ row: 0, reason: 'The file was empty.' }],
    }
  }

  const rawHeaders = table[0]!.map((header) => header.trim())
  const mapped = rawHeaders.map(normaliseHeader)

  const recognised: string[] = []
  const unrecognised: string[] = []
  const ignoredPlacementColumns: string[] = []

  mapped.forEach((key, index) => {
    const original = rawHeaders[index] ?? ''
    if (original === '') return
    if (PLACEMENT_HEADERS.has(key)) ignoredPlacementColumns.push(original)
    else if (key in EMPTY_ROW) recognised.push(original)
    else unrecognised.push(original)
  })

  const rows: IngestRow[] = []
  const skipped: IngestIssue[] = []
  const seen = new Map<string, number>()

  for (let index = 1; index < table.length; index += 1) {
    // 1-based, and counting the header, so it matches what the operator sees
    // in their spreadsheet.
    const rowNumber = index + 1
    const cells = table[index]!
    const candidate: Record<string, string> = {}

    mapped.forEach((key, column) => {
      if (PLACEMENT_HEADERS.has(key)) return
      const value = (cells[column] ?? '').trim()
      if (value !== '' && key in EMPTY_ROW) candidate[key] = value
    })

    const missing = REQUIRED.filter((field) => !candidate[field])
    if (missing.length > 0) {
      skipped.push({
        row: rowNumber,
        reason: `Missing ${missing.map((field) => LABELS[field]).join(' and ')}.`,
      })
      continue
    }

    const email = candidate.email!.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ row: rowNumber, reason: `"${candidate.email}" is not an email address.` })
      continue
    }

    const previous = seen.get(email)
    if (previous !== undefined) {
      skipped.push({
        row: rowNumber,
        reason: `Duplicate email within this file — first seen on row ${previous}. This row was ignored.`,
      })
      continue
    }
    seen.set(email, rowNumber)

    rows.push({
      fullName: candidate.fullName!,
      email,
      phone: candidate.phone ?? null,
      schoolName: candidate.schoolName ?? null,
      grade: candidate.grade ?? null,
      committeePreference: candidate.committeePreference ?? null,
      committeePreference2: candidate.committeePreference2 ?? null,
      dietaryNotes: candidate.dietaryNotes ?? null,
      accessibilityNotes: candidate.accessibilityNotes ?? null,
    })
  }

  return { rows, recognised, unrecognised, ignoredPlacementColumns, skipped }
}

const EMPTY_ROW: Record<keyof IngestRow, null> = {
  fullName: null,
  email: null,
  phone: null,
  schoolName: null,
  grade: null,
  committeePreference: null,
  committeePreference2: null,
  dietaryNotes: null,
  accessibilityNotes: null,
}

const LABELS: Record<keyof IngestRow, string> = {
  fullName: 'a name',
  email: 'an email address',
  phone: 'a phone number',
  schoolName: 'a school',
  grade: 'a year',
  committeePreference: 'a preference',
  committeePreference2: 'a second preference',
  dietaryNotes: 'dietary notes',
  accessibilityNotes: 'accessibility notes',
}

/** A sentence an operator can act on, for the import summary. */
export function describeIngest(result: IngestResult): string {
  const parts = [`${result.rows.length} row${result.rows.length === 1 ? '' : 's'} ready`]

  if (result.ignoredPlacementColumns.length > 0) {
    const names = result.ignoredPlacementColumns.map((header) => `"${header}"`).join(' and ')
    const verb = result.ignoredPlacementColumns.length === 1 ? 'was' : 'were'
    parts.push(
      `${names} ${verb} ignored — importing never allocates, so place delegates on the allocations screen`,
    )
  }

  if (result.unrecognised.length > 0) {
    parts.push(`${result.unrecognised.map((h) => `"${h}"`).join(', ')} not recognised`)
  }

  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} row${result.skipped.length === 1 ? '' : 's'} skipped`)
  }

  return `${parts.join('. ')}.`
}
