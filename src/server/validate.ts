/**
 * Validation.
 *
 * Two things about this matter, and both are ported deliberately.
 *
 * 1. It answers 422, not 400, with `details: [{ path, message }]`. The client
 *    unpacks exactly this into operator-facing text, so changing the shape
 *    silently degrades every form in the product to "Validation failed".
 *
 * 2. It returns the *parsed* value, and callers must use the return value
 *    rather than the input they passed in. Downstream code therefore receives
 *    coerced, trimmed, stripped data and never the raw request. This is what
 *    makes it safe to read `body.email` without re-checking it.
 *
 * Ported from the reference product's apps/backend/src/middleware/validate.ts.
 */

import type { ZodType } from 'zod'
import { ApiError } from './errors.ts'

export interface FieldIssue {
  path: string
  message: string
}

export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  const details: FieldIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }))

  throw ApiError.unprocessable('Validation failed', details)
}

/**
 * Request bodies arrive as a promise of unknown JSON, and a malformed body
 * throws inside `req.json()` rather than producing a value to validate. That
 * is a 400 about syntax, not a 422 about content.
 */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw ApiError.badRequest('The request body was not valid JSON')
  }
  return parseOrThrow(schema, raw)
}

/**
 * URLSearchParams is a multimap of strings. Repeated keys collapse to an array
 * so `?status=OPEN&status=CLOSED` reaches the schema as one, and everything
 * else stays a string for the schema to coerce.
 */
export function parseSearchParams<T>(url: URL, schema: ZodType<T>): T {
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const [first, ...rest] = url.searchParams.getAll(key)
    raw[key] = rest.length > 0 ? [first ?? '', ...rest] : (first ?? '')
  }
  return parseOrThrow(schema, raw)
}
