/**
 * XLSX.
 *
 * An .xlsx file is a ZIP of XML parts, and this writes both by hand. That is a
 * deliberate choice over `exceljs` or SheetJS, made on deployment grounds
 * rather than on size:
 *
 * - SheetJS is no longer published to npm and the abandoned `xlsx` package
 *   there is a supply-chain liability in a product that handles other people's
 *   delegate lists.
 * - `exceljs` pulls a Node stream and zip stack that has to be marked external
 *   for the serverless bundle, which is the same class of problem
 *   `serverExternalPackages` already exists for in `next.config.ts`.
 *
 * What is here is about two hundred lines with no runtime dependency beyond
 * `node:zlib`, and every byte of it is covered by a test that unzips the output
 * and reads the values back.
 *
 * Strings are written as **inline strings** rather than through a shared string
 * table. It costs some file size on a list with many repeated schools and saves
 * a whole part, its index and the class of bug where the table and the sheet
 * disagree about an index. It also means every cell is explicitly typed as a
 * string, so a delegate named `=cmd|…` is a string cell — Excel never evaluates
 * one, which is why the CSV formula defence has no counterpart here.
 */

import { deflateRawSync } from 'node:zlib'
import { cellText, type CellValue, type Table } from './table.ts'

/* -------------------------------------------------------------------------- */
/* ZIP                                                                         */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

/**
 * A ZIP with one deflated entry per part.
 *
 * No timestamps: every field that would carry one is written as zero, so the
 * same table exports to a byte-identical file every time. That is what makes
 * the exporter testable at all — a checksum over the output is meaningless if
 * the output embeds the current minute.
 */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const checksum = crc32(entry.data)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 filenames
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0, 12) // date
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, compressed)
    centrals.push(central)
    offset += local.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralDirectory, end])
}

/* -------------------------------------------------------------------------- */
/* OOXML                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * XML text escaping, plus the control characters XML 1.0 cannot represent at
 * all.
 *
 * The second half matters more than it looks: a delegate pasted from a PDF
 * arrives with a vertical tab in their school name often enough, and a raw
 * 0x0B in a sheet is not an ugly cell, it is a file Excel refuses to open with
 * a message that names no cause.
 */
function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** `0` -> `A`, `26` -> `AA`. */
export function columnName(index: number): string {
  let name = ''
  let remaining = index
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return name
}

/**
 * A sheet name Excel will accept.
 *
 * Excel silently refuses to open a workbook whose sheet name holds any of
 * `:\/?*[]`, is longer than 31 characters, or is empty — refuses, not repairs.
 */
function sheetName(title: string): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31)
  return cleaned.length > 0 ? cleaned : 'Sheet1'
}

function cellXml(reference: string, value: CellValue, styleIndex: number): string {
  const style = styleIndex > 0 ? ` s="${styleIndex}"` : ''

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`
  }

  const text = cellText(value)
  if (text === '') return `<c r="${reference}"${style}/>`

  // `xml:space="preserve"` or Excel eats leading and trailing spaces.
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`
}

function sheetXml(table: Table): string {
  const rows: string[] = []

  const header = table.columns
    .map((column, index) => cellXml(`${columnName(index)}1`, column.header, 1))
    .join('')
  rows.push(`<row r="1">${header}</row>`)

  table.rows.forEach((row, rowIndex) => {
    const number = rowIndex + 2
    const cells = table.columns
      .map((_, columnIndex) => cellXml(`${columnName(columnIndex)}${number}`, row[columnIndex], 0))
      .join('')
    rows.push(`<row r="${number}">${cells}</row>`)
  })

  /*
    Column widths are estimated from the longest value, capped at 60.

    Not cosmetic. The default width truncates every email address in the sheet
    to `#####` or to an ellipsis, and the first thing an organiser does with an
    unreadable export is widen forty columns by hand, once per export.
  */
  const widths = table.columns
    .map((column, index) => {
      const longest = table.rows.reduce(
        (max, row) => Math.max(max, cellText(row[index]).length),
        column.header.length,
      )
      const width = Math.min(60, Math.max(10, longest + 2))
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    })
    .join('')

  const lastColumn = columnName(Math.max(0, table.columns.length - 1))
  const lastRow = table.rows.length + 1

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    // Freezing the header is the difference between a usable register and one
    // where row 300 has no column labels.
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<cols>${widths}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    // An autofilter on the header row, so the sheet arrives ready to sort.
    `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` +
    `</worksheet>`
  )
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`

/** Two cell formats: index 0 plain, index 1 bold, for the header row. */
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `</styleSheet>`

export function toXlsx(table: Table): Buffer {
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xml(sheetName(table.title))}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(table), 'utf8') },
  ])
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
