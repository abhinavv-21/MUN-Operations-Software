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
import { ApiError } from './errors.ts'

/**
 * Postgres write conflict / could not serialize access.
 *
 * Prisma reports this as `P2034` through its own engine. Through a **driver
 * adapter** — which is how Prisma 7 talks to Postgres here — the same failure
 * arrives as a `DriverAdapterError: TransactionWriteConflict` wrapped in a
 * `PrismaClientKnownRequestError`, and matching only on `P2034` misses it
 * entirely.
 *
 * The consequence is not subtle: every retryable conflict became an unhandled
 * 500. Two organisers allocating at the same moment would each have seen the
 * product break rather than one of them seeing a clean conflict. Found by the
 * capacity race test, which is exactly what it is for.
 */
const SERIALIZATION_FAILURE = 'P2034'

/** Postgres SQLSTATE for serialization_failure, in case a driver surfaces it raw. */
const SQLSTATE_SERIALIZATION_FAILURE = '40001'

function isSerializationFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown }
  if (candidate.code === SERIALIZATION_FAILURE) return true
  if (candidate.code === SQLSTATE_SERIALIZATION_FAILURE) return true

  const message = typeof candidate.message === 'string' ? candidate.message : ''
  if (
    message.includes('TransactionWriteConflict') ||
    message.includes('could not serialize access') ||
    message.includes('deadlock detected')
  ) {
    return true
  }

  // The adapter nests the real failure, so unwrap one level.
  return candidate.cause !== undefined && candidate.cause !== error
    ? isSerializationFailure(candidate.cause)
    : false
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
      // Backoff grows with the attempt, and is jittered so that N callers that
      // collided once do not all wake at the same moment and collide again.
      if (attempt < attempts) await sleep(25 * attempt + Math.floor(Math.random() * 25))
    }
  }

  /*
    Every attempt lost the race. That is a conflict, not a server fault: another
    organiser reached the same seat first, repeatedly. Surfacing the raw driver
    error would answer 500 and tell the operator the product is broken, when the
    correct thing for them to do is look at the row and try again.
  */
  if (isSerializationFailure(lastError)) {
    throw ApiError.conflict(
      'Someone else changed this at the same moment. Check the current state and try again.',
    )
  }

  throw lastError
}
