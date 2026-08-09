/**
 * The error contract.
 *
 * Every API failure, everywhere, is this shape. There are no exceptions to it.
 * The client's `errorMessage()` helper depends on it and so does every test, so
 * the first `NextResponse.json({ message })` written by hand is the moment the
 * contract stops being one.
 *
 * Ported from the reference product's apps/backend/src/lib/errors.ts.
 */

export interface ApiErrorBody {
  error: string
  code: number
  /** Omitted entirely when undefined, never serialised as `null`. */
  details?: unknown
}

export class ApiError extends Error {
  readonly code: number
  readonly details?: unknown

  constructor(message: string, code: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.message, code: this.code }
    if (this.details !== undefined) body.details = this.details
    return body
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(message, 400, details)
  }

  static unauthorized(message = 'Authentication required', details?: unknown) {
    return new ApiError(message, 401, details)
  }

  static forbidden(message = 'You do not have access to this', details?: unknown) {
    return new ApiError(message, 403, details)
  }

  /**
   * Also the correct answer for "this exists but is not yours". Answering 403
   * confirms the resource exists to someone who should not know that.
   */
  static notFound(message = 'Not found', details?: unknown) {
    return new ApiError(message, 404, details)
  }

  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError(message, 409, details)
  }

  static unprocessable(message = 'Validation failed', details?: unknown) {
    return new ApiError(message, 422, details)
  }

  static tooManyRequests(message = 'Too many attempts', details?: unknown) {
    return new ApiError(message, 429, details)
  }

  static serviceUnavailable(message = 'That is not available right now', details?: unknown) {
    return new ApiError(message, 503, details)
  }

  static internal(message = 'Something went wrong', details?: unknown) {
    return new ApiError(message, 500, details)
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}
