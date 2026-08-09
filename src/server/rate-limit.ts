import { ApiError } from './errors.ts'

/**
 * Rate limiting for the public endpoints.
 *
 * Backed by Upstash Redis over HTTP, and this is the one decision in Stage 5
 * that must not be carried over from the reference unthinkingly. Its limiter is
 * `express-rate-limit` with an in-process store: on a platform that runs many
 * instances, each keeps its own counter, so the effective ceiling is the limit
 * multiplied by however many instances happen to be warm. The reference's own
 * notes admit this and call it "friction rather than a hard cap". A shared
 * counter makes it an actual cap.
 *
 * Implemented directly against the REST API rather than through
 * `@upstash/ratelimit`, because the whole algorithm is two commands and the
 * dependency would be larger than the code.
 */

interface Window {
  /** How long the window lasts, in seconds. */
  seconds: number
  /** How many requests are allowed inside it. */
  limit: number
}

/**
 * Far below anything an authenticated route would use, because this is
 * reachable by anyone.
 *
 * The busiest legitimate pattern is a teacher registering a delegation one
 * student at a time from a single school IP. Five in a quarter of an hour is a
 * comfortable ceiling on that — filling the form honestly takes a minute or
 * two — and twenty an hour lets a whole delegation through across a sitting
 * while costing a scripted flood four rejections in five.
 */
export const SUBMISSION_BURST: Window = { seconds: 15 * 60, limit: 5 }
export const SUBMISSION_SUSTAINED: Window = { seconds: 60 * 60, limit: 20 }

/**
 * Its own budget, because asking for an upload URL is not a submission.
 *
 * Ten in a quarter of an hour sits above the five submissions the same window
 * allows: one screenshot per application, plus room to retry a photo that came
 * out unreadable. Any higher and this becomes free anonymous file hosting on
 * the organiser's object store, which is the only thing standing between the
 * endpoint and someone filling the bucket — a presigned PUT cannot cap its own
 * body size.
 */
export const UPLOAD_BURST: Window = { seconds: 15 * 60, limit: 10 }

function config(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url: url.replace(/\/+$/, ''), token }
}

export function rateLimitingEnabled(): boolean {
  return config() !== null
}

/**
 * One fixed window, as INCR plus a conditional EXPIRE.
 *
 * A fixed window rather than a sliding log: the log costs a sorted set per key
 * and its precision buys nothing here, where the limits exist to make scripted
 * abuse expensive rather than to meter a paid API. The known cost is that a
 * caller can spend two windows' worth of requests across a window boundary,
 * which for five submissions in fifteen minutes is not worth the machinery.
 */
async function hit(
  key: string,
  window: Window,
): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> {
  const upstash = config()
  if (!upstash) return { allowed: true, remaining: window.limit, resetSeconds: 0 }

  const send = async (command: string[]): Promise<unknown> => {
    const response = await fetch(upstash.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstash.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Upstash responded ${response.status}`)
    const body = (await response.json()) as { result?: unknown }
    return body.result
  }

  const count = Number(await send(['INCR', key]))

  // Only the request that created the key sets its lifetime. Calling EXPIRE on
  // every hit would slide the window forward forever and the counter would
  // never reset.
  if (count === 1) await send(['EXPIRE', key, String(window.seconds)])

  const ttl = Number(await send(['TTL', key]))

  return {
    allowed: count <= window.limit,
    remaining: Math.max(0, window.limit - count),
    resetSeconds: ttl > 0 ? ttl : window.seconds,
  }
}

/**
 * Applies every window and throws 429 if any is exhausted.
 *
 * Fails **open** when Redis is unreachable. A rate limiter that takes the
 * public form down when a third party has an incident is a worse outcome than
 * a few minutes of unmetered submissions — the honeypot and the one-live-
 * application rule are what actually keep the table clean. The failure is
 * logged rather than swallowed silently.
 */
export async function enforceRateLimit(
  scope: string,
  identifier: string,
  windows: Window[],
): Promise<void> {
  if (!rateLimitingEnabled()) return

  try {
    for (const [index, window] of windows.entries()) {
      const key = `rl:${scope}:${index}:${identifier}`
      const result = await hit(key, window)

      if (!result.allowed) {
        throw ApiError.tooManyRequests(
          'Too many attempts. Try again a little later.',
          { retryAfterSeconds: result.resetSeconds },
        )
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    console.error('[rate-limit] Redis unreachable, allowing the request', error)
  }
}
