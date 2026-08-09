import type { LimitDetails } from '@/server/limits.ts'

/**
 * The client half of the error contract.
 *
 * Ported from the reference product, minus everything that existed because its
 * API lived on another origin behind bearer tokens. Deleted with it: the token
 * store in `localStorage`, `refreshTokens`, the single-in-flight-refresh
 * promise, the 401-retry dance and `setSessionExpiredHandler`. Session cookies
 * are sent automatically and refreshed by proxy.ts, so none of that has
 * anything left to do.
 */

export interface ApiErrorBody {
  error: string
  code: number
  details?: unknown
}

export class ApiError extends Error {
  readonly code: number
  readonly details?: unknown

  constructor(body: ApiErrorBody) {
    super(body.error)
    this.name = 'ApiError'
    this.code = body.code
    this.details = body.details
  }

  /** True when the failure is a lost connection rather than a server response. */
  get isOffline(): boolean {
    return this.code === 0
  }

  /**
   * The plan limit this failure is about, when it is one.
   *
   * The UI renders its upgrade prompt from this rather than from the status
   * code, which is why the status can stay an honest 403.
   */
  get limit(): LimitDetails | null {
    const details = this.details
    if (typeof details === 'object' && details !== null && 'limit' in details) {
      return details as LimitDetails
    }
    return null
  }
}

/** Field labels for the payload keys the API validates, in operator language. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  slug: 'Address',
  email: 'Email',
  code: 'Code',
  edition: 'Edition',
  venue: 'Venue',
  startsOn: 'Start date',
  endsOn: 'End date',
  registrationDeadline: 'Registration deadline',
  feeMinorUnits: 'Fee',
  feeCurrency: 'Currency',
  seats: 'Seats',
  country: 'Country',
  countries: 'Countries',
  orgRole: 'Role',
  role: 'Role',
  token: 'Invitation',
}

/**
 * A message a person can act on.
 *
 * The API answers a rejected payload with "Validation failed" and puts the
 * actual problem in `details`, so a form that shows only the top-level message
 * names no field, no rule and no fix — for a mistake as ordinary as a mistyped
 * email. This unpacks it: "Email — Enter a valid email address."
 */
export function errorMessage(caught: unknown, fallback = 'Something went wrong.'): string {
  if (!(caught instanceof ApiError)) {
    return caught instanceof Error && caught.message ? caught.message : fallback
  }

  const details = caught.details
  if (Array.isArray(details)) {
    const lines = details
      .filter(
        (issue): issue is { path?: unknown; message?: unknown } =>
          typeof issue === 'object' && issue !== null,
      )
      .map((issue) => {
        const path = typeof issue.path === 'string' ? issue.path : ''
        const message = typeof issue.message === 'string' ? issue.message : ''
        if (message === '') return ''
        const label = FIELD_LABELS[path] ?? (path && path !== '(root)' ? path : '')
        return label ? `${label} — ${message}` : message
      })
      .filter((line) => line !== '')

    if (lines.length > 0) return lines.join('. ')
  }

  return caught.message || fallback
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody
    return new ApiError({
      error: body.error ?? response.statusText,
      code: body.code ?? response.status,
      details: body.details,
    })
  } catch {
    return new ApiError({ error: response.statusText || 'Request failed', code: response.status })
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options

  let response: Response
  try {
    response = await fetch(path, {
      ...rest,
      // Same origin, so the session cookie rides along without being asked.
      // This is the main thing gained by collapsing the reference's separate
      // SPA and API into one deployment.
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    /*
      `fetch` only throws for a network-level failure, and there are two of
      them. Reporting both as "you are offline" sent people to check their wifi
      while the wifi was fine.

      The other is a request that left and got no answer — a cold serverless
      start, a dropped connection mid-flight, a captive portal swallowing it.
      Indistinguishable from here except by asking the browser whether it
      believes it has a connection at all.

      Code 0 either way, because callers use it to mean "the request never
      reached the API", and both of these are that.
    */
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new ApiError({
      error: offline
        ? 'You appear to be offline. The request was not sent.'
        : 'The server did not respond. Wait a few seconds and try again.',
      code: 0,
    })
  }

  if (!response.ok) throw await toApiError(response)

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) return (await response.blob()) as T

  return (await response.json()) as T
}
