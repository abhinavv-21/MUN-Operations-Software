import { randomBytes } from 'node:crypto'

/**
 * UUID v7 — a 48-bit millisecond timestamp followed by randomness.
 *
 * Generated here rather than by the database for one specific case: creating an
 * organisation needs the organisation's id *before* the first write, so that
 * `scope({ organizationId })` exists and the membership and audit rows can be
 * written through the same tenant-scoped client, in one transaction. Letting
 * Postgres pick the id would mean creating the organisation first, unscoped,
 * and then hoping the second step succeeds.
 *
 * v7 rather than v4 because the leading timestamp keeps inserts at the right
 * edge of the primary key index instead of scattering them across it, which
 * matters once a table has a few hundred thousand rows.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16)
  const now = Date.now()

  bytes[0] = (now / 2 ** 40) & 0xff
  bytes[1] = (now / 2 ** 32) & 0xff
  bytes[2] = (now / 2 ** 24) & 0xff
  bytes[3] = (now / 2 ** 16) & 0xff
  bytes[4] = (now / 2 ** 8) & 0xff
  bytes[5] = now & 0xff

  // Version 7 in the high nibble of byte 6, RFC 9562 variant in byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
