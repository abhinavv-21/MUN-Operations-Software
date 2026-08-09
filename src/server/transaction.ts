/**
 * Serializable transactions.
 *
 * This exists because seat capacity is a read-then-write. Two organisers
 * allocating the last seat in UNSC at the same moment will both read "14 of 15
 * filled" and both write, without it.
 *
 * The database-level unique constraint catches the country collision; this
 * catches the capacity one. You need both, and neither substitutes for the
 * other.
 *
 * Ported from the reference product's apps/backend/src/lib/transaction.ts.
 */

import type { ScopedClient } from './db.ts'

/** Postgres write conflict / could not serialize access. */
const SERIALIZATION_FAILURE = 'P2034'

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === SERIALIZATION_FAILURE
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `work` at Serializable isolation, retrying only on a write conflict.
 * Anything else propagates immediately: retrying a unique-constraint violation
 * three times just fails three times more slowly.
 *
 * The client handed to `work` is still tenant-scoped. Prisma's interactive
 * transactions yield extended clients, which is verified by a test rather than
 * trusted.
 */
export async function runSerializable<T>(
  db: ScopedClient,
  work: (tx: ScopedClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return (await db.$transaction((tx) => work(tx as unknown as ScopedClient), {
        isolationLevel: 'Serializable',
        timeout: 10_000,
      })) as T
    } catch (error) {
      if (!isSerializationFailure(error)) throw error
      lastError = error
      if (attempt < attempts) await sleep(25 * attempt)
    }
  }

  throw lastError
}
