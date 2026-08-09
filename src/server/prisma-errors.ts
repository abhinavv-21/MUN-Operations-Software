/**
 * The Prisma error ladder.
 *
 * A known database error is translated rather than leaked. Without this, a
 * unique-constraint violation reaches the client as a 500 carrying the
 * constraint name, the table name and the column list, which is both a worse
 * error message and a schema disclosure.
 *
 * Ported from the reference product's apps/backend/src/middleware/errorHandler.ts.
 */

import { ApiError } from './errors.ts'

/**
 * Prisma 7 no longer exports the error classes from a stable runtime entry
 * point that is safe to import from every environment, so the codes are matched
 * structurally. The shape has been stable across every major version.
 */
function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined
}

function isPrismaValidationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'PrismaClientValidationError'
  )
}

function targetOf(error: unknown): string[] {
  const meta = (error as { meta?: { target?: unknown } } | null)?.meta
  const target = meta?.target
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === 'string')
  if (typeof target === 'string') return [target]
  return []
}

/**
 * Returns an ApiError for a database error we recognise, or undefined so the
 * caller can fall through to a 500.
 */
export function translatePrismaError(error: unknown): ApiError | undefined {
  if (isPrismaValidationError(error)) {
    return ApiError.badRequest('The request did not match what the database expected')
  }

  const code = prismaErrorCode(error)
  if (!code) return undefined

  switch (code) {
    case 'P2002': {
      const target = targetOf(error)
      const has = (...cols: string[]) => cols.every((c) => target.includes(c))

      // Specific messages for the collisions an operator will actually hit.
      // "Unique constraint failed on the fields: (conferenceId, code)" is true
      // and useless to someone importing a matrix.
      if (has('conferenceId', 'committeeId', 'country') || has('committeeId', 'country')) {
        return ApiError.conflict('That country is already allocated in this committee')
      }
      if (has('conferenceId', 'delegateId') || has('delegateId')) {
        return ApiError.conflict('That delegate already holds an allocation')
      }
      if (has('conferenceId', 'email')) {
        return ApiError.conflict('Someone with that email is already registered for this conference')
      }
      if (has('conferenceId', 'code') || has('conferenceId', 'name')) {
        return ApiError.conflict('A committee with that code or name already exists in this conference')
      }
      if (has('organizationId', 'slug') || has('slug')) {
        return ApiError.conflict('That address is already taken')
      }
      return ApiError.conflict('That already exists', target.length ? { fields: target } : undefined)
    }

    case 'P2003':
      return ApiError.badRequest('That refers to something which does not exist')

    case 'P2025':
      return ApiError.notFound('Not found')

    default:
      return undefined
  }
}
