/**
 * PDF.
 *
 * Written by hand, for the same deployment reason as the XLSX writer and one
 * more that is specific to PDF: `pdfkit` loads its font metrics from `.afm`
 * files on disk at runtime, and a serverless bundle does not carry them. That
 * failure appears only in production, only on the export route, and reads as a
 * missing-file error about a font nobody wrote.
 *
 * The way around it is to use the **standard 14** fonts, which every PDF reader
 * already has and which therefore need no file, no embedding and no metrics
 * lookup at all.
 *
 * ## Why the table is set in Courier
 *
 * Accurate proportional layout needs a per-glyph width table, and a width table
 * transcribed by hand is a silent layout bug waiting for the one string that
 * exercises the wrong entry. Courier is monospaced at exactly 600/1000 em, so
 * every measurement here is a multiplication that cannot be subtly wrong. An
 * operational printout that a runner reads off a clipboard is a place where
 * columns that line up beat columns that are prettier.
 *
 * Headings are Helvetica-Bold, which is only ever left-aligned and so needs no
 * measurement.
 *
 * ## The honest limitation
 *
 * The standard 14 fonts cover WinAnsi — Latin-1 plus a handful of typographic
 * characters. Accented Latin names are fine. **A name in Devanagari, Arabic or
 * a CJK script cannot be represented and is written as `?`.** That is a real
 * limitation of not embedding a font, it is recorded in `docs/01-CURRENT-STATE.md`,
 * and CSV and XLSX are both full UTF-8 — which is why the export screen offers
 * three formats rather than defaulting everyone to the printable one.
 */

import { cellText, type Table } from './table.ts'

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** A4 landscape, in points. Wide, because operational tables are wide. */
const PAGE_WIDTH = 842
const PAGE_HEIGHT = 595
const MARGIN = 36

const TITLE_SIZE = 15
const SUBTITLE_SIZE = 9
const BODY_SIZE = 8
const LINE_HEIGHT = 12.5

/** Courier is 600/1000 em at every size. This is the whole metrics table. */
const COURIER_ADVANCE = 0.6
const charWidth = (size: number) => size * COURIER_ADVANCE

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The characters WinAnsiEncoding places in 0x80–0x9F, which are the ones a
 * delegate list actually collects: curly quotes and dashes pasted out of Word,
 * and the ellipsis this file writes itself when it truncates.
 */
const WIN_ANSI_HIGH: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
}

const ELLIPSIS = '…'

/**
 * One character of the source string to one WinAnsi byte, or `?`.
 *
 * Substituting rather than dropping is deliberate: a name rendered as `Zh?ng`
 * tells the reader a character was lost, while `Zhng` looks like a typo the
 * organiser made and will be "corrected" in the database.
 */
export function toWinAnsi(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out += ' '
      continue
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += character
      continue
    }
    const high = WIN_ANSI_HIGH[character]
    if (high !== undefined) {
      out += String.fromCharCode(high)
      continue
    }
    if (code >= 0xa0 && code <= 0xff) {
      out += character
      continue
    }
    out += '?'
  }
  return out
}

/** A PDF literal string. Backslash, both parens, and nothing else. */
function pdfString(value: string): string {
  return toWinAnsi(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (value.length <= maxChars) return value
  if (maxChars === 1) return ELLIPSIS
  return `${value.slice(0, maxChars - 1)}${ELLIPSIS}`
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Splits the available width between columns.
 *
 * Each column asks for what its longest value needs and is granted its share of
 * whatever is available, so one long notes column cannot squeeze the delegate
 * name down to three characters. Every column keeps a floor of six characters,
 * because a column narrower than its own truncation marker is noise that still
 * costs width.
 */
export function columnWidths(table: Table, availableChars: number): number[] {
  const wanted = table.columns.map((column, index) => {
    const longest = table.rows.reduce(
      (max, row) => Math.max(max, cellText(row[index]).length),
      column.header.length,
    )
    return Math.max(6, Math.min(48, longest))
  })

  const gaps = table.columns.length - 1
  const usable = availableChars - gaps
  const total = wanted.reduce((sum, value) => sum + value, 0)

  if (total <= usable) return wanted

  // Scale down proportionally, then hand the rounding remainder to the widest
  // column rather than losing it.
  const scaled = wanted.map((value) => Math.max(6, Math.floor((value / total) * usable)))
  let slack = usable - scaled.reduce((sum, value) => sum + value, 0)
  for (let index = 0; slack > 0 && index < scaled.length; index = (index + 1) % scaled.length) {
    scaled[index] = scaled[index]! + 1
    slack -= 1
  }
  return scaled
}

function padCell(text: string, width: number, numeric: boolean): string {
  const clipped = truncate(text, width)
  const padding = ' '.repeat(Math.max(0, width - clipped.length))
  return numeric ? `${padding}${clipped}` : `${clipped}${padding}`
}

/* -------------------------------------------------------------------------- */
/* Writer                                                                      */
/* -------------------------------------------------------------------------- */

interface Line {
  text: string
  bold: boolean
}

function paginate(table: Table, widths: number[]): Line[][] {
  const header = table.columns
    .map((column, index) => padCell(column.header.toUpperCase(), widths[index]!, false))
    .join(' ')
  const rule = widths.map((width) => '-'.repeat(width)).join(' ')

  const bodyTop = PAGE_HEIGHT - MARGIN - TITLE_SIZE - SUBTITLE_SIZE - 22
  const bodyBottom = MARGIN + 16
  const rowsPerPage = Math.max(1, Math.floor((bodyTop - bodyBottom) / LINE_HEIGHT) - 2)

  const pages: Line[][] = []
  const rows = table.rows.length > 0 ? table.rows : [[]]

  for (let start = 0; start < rows.length; start += rowsPerPage) {
    const lines: Line[] = [
      { text: header, bold: true },
      { text: rule, bold: false },
    ]
    for (const row of rows.slice(start, start + rowsPerPage)) {
      lines.push({
        text: table.columns
          .map((column, index) =>
            padCell(cellText(row[index]), widths[index]!, column.numeric === true),
          )
          .join(' '),
        bold: false,
      })
    }
    pages.push(lines)
  }

  if (table.rows.length === 0) {
    pages[0] = [
      { text: header, bold: true },
      { text: rule, bold: false },
      { text: 'Nothing to list.', bold: false },
    ]
  }

  return pages
}

function contentStream(
  table: Table,
  lines: Line[],
  pageNumber: number,
  pageCount: number,
  stamp: Date,
): string {
  const parts: string[] = []
  const left = MARGIN

  let y = PAGE_HEIGHT - MARGIN - TITLE_SIZE

  parts.push('BT')
  parts.push(`/FTitle ${TITLE_SIZE} Tf`)
  parts.push('0 g')
  parts.push(`1 0 0 1 ${left} ${y} Tm`)
  parts.push(`(${pdfString(table.title)}) Tj`)
  parts.push('ET')

  y -= SUBTITLE_SIZE + 6
  const subtitle = [table.subtitle, `Generated ${stamp.toISOString().slice(0, 16).replace('T', ' ')} UTC`]
    .filter((value): value is string => Boolean(value))
    .join('  ·  ')

  parts.push('BT')
  parts.push(`/FSans ${SUBTITLE_SIZE} Tf`)
  // 40% grey. Not a theme colour: a printout has no theme, and this is the one
  // place in the product where ink is literally ink.
  parts.push('0.4 g')
  parts.push(`1 0 0 1 ${left} ${y} Tm`)
  parts.push(`(${pdfString(subtitle)}) Tj`)
  parts.push('ET')

  y -= 16

  parts.push('BT')
  parts.push('0 g')
  parts.push(`1 0 0 1 ${left} ${y} Tm`)
  parts.push(`${LINE_HEIGHT} TL`)

  let currentFont = ''
  lines.forEach((line, index) => {
    const font = line.bold ? '/FMonoBold' : '/FMono'
    if (font !== currentFont) {
      parts.push(`${font} ${BODY_SIZE} Tf`)
      currentFont = font
    }
    if (index > 0) parts.push('T*')
    parts.push(`(${pdfString(line.text)}) Tj`)
  })
  parts.push('ET')

  parts.push('BT')
  parts.push(`/FSans ${SUBTITLE_SIZE} Tf`)
  parts.push('0.4 g')
  parts.push(`1 0 0 1 ${left} ${MARGIN} Tm`)
  parts.push(`(${pdfString(`Page ${pageNumber} of ${pageCount}`)}) Tj`)
  parts.push('ET')

  return parts.join('\n')
}

/**
 * Assembles the file.
 *
 * Byte offsets in the cross-reference table have to be exact, so the body is
 * built as latin1 text and measured with `Buffer.byteLength(…, 'latin1')` — one
 * byte per character by construction, which is the reason everything above
 * passes through `toWinAnsi` first.
 */
export function toPdf(table: Table, stamp = new Date()): Buffer {
  const availableChars = Math.floor((PAGE_WIDTH - MARGIN * 2) / charWidth(BODY_SIZE))
  const widths = columnWidths(table, availableChars)
  const pages = paginate(table, widths)

  const objects: string[] = []
  /** 1-based object numbers, in the order they are pushed. */
  const push = (body: string) => {
    objects.push(body)
    return objects.length
  }

  // Reserved: 1 catalog, 2 page tree. Both need ids their contents do not know
  // yet, so they are written last into slots claimed now.
  objects.push('', '')

  const fonts = {
    FTitle: push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    FSans: push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    FMono: push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
    FMonoBold: push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>'),
  }

  const fontResource =
    `<< /FTitle ${fonts.FTitle} 0 R /FSans ${fonts.FSans} 0 R ` +
    `/FMono ${fonts.FMono} 0 R /FMonoBold ${fonts.FMonoBold} 0 R >>`

  const pageIds: number[] = []
  pages.forEach((lines, index) => {
    const stream = contentStream(table, lines, index + 1, pages.length, stamp)
    const streamId = push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    )
    pageIds.push(
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font ${fontResource} >> /Contents ${streamId} 0 R >>`,
      ),
    )
  })

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(body, 'latin1')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(body + xref + trailer, 'latin1')
}

export const PDF_CONTENT_TYPE = 'application/pdf'
