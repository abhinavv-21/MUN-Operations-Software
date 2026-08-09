/**
 * What may be queued, and what must fail in front of the person who typed it.
 *
 * Pure. No Dexie, no `fetch`, no `window` — so the rule that matters can be
 * tested without a browser, and so the rule lives somewhere other than inside
 * the code that happens to implement it.
 *
 * ## The rule
 *
 * **Exactly two writes may be queued: a logistics request and an attendance
 * check-in.** Everything else fails immediately.
 *
 * This is a product decision, not a technical limit. Queueing a delegate edit
 * means queueing a conflict that cannot be resolved later without showing an
 * operator a merge dialog they will not understand, and the failure it produces
 * is the worst kind: two people both believing they hold the truth, discovering
 * otherwise on the day, with no record of which edit won.
 *
 * The two that are allowed are allowed because both are **append-only from the
 * operator's point of view and idempotent on the server**:
 *
 * - a check-in is keyed by `(conference, delegate, day)`, so a replay finds the
 *   same row;
 * - a logistics request carries a `clientRequestId` minted here, so a replay
 *   finds the same row.
 *
 * Neither can conflict with someone else's work, because neither overwrites
 * anything. That property — not the fact that they are important — is what
 * makes them safe to hold. Anything without it does not get added to this list,
 * however loudly it is asked for.
 *
 * See the comment on `networkMode: 'always'` in `src/app/providers.tsx` for the
 * other half of the arrangement: everything not on this list must fail fast
 * rather than sit on "Saving".
 */

/** The two, and only the two. */
export const QUEUEABLE_KINDS = ['logistics.create', 'attendance.checkin'] as const

export type QueueableKind = (typeof QUEUEABLE_KINDS)[number]

export function isQueueable(kind: string): kind is QueueableKind {
  return (QUEUEABLE_KINDS as readonly string[]).includes(kind)
}

/** The message a person sees when they tried to do something else offline. */
export const NOT_QUEUEABLE_MESSAGE =
  'You appear to be offline. This change was not saved — only check-ins and logistics requests ' +
  'can be made offline.'

export interface QueuedWrite {
  /** Monotonic, assigned by the store. Replay order is insertion order. */
  id?: number
  kind: QueueableKind
  /** Same-origin path. Stored whole so a replay needs no reconstruction. */
  url: string
  body: unknown
  /** Milliseconds since the epoch, for the "queued 4 minutes ago" line. */
  queuedAt: number
  attempts: number
  lastError?: string
}

/**
 * What to do with a queued write after an attempt.
 *
 * The three outcomes are genuinely different and collapsing any two of them
 * breaks the queue in a way that is hard to see:
 *
 * - `done` — it landed. Drop it.
 * - `retry` — the request never reached the API. Keep it, stop flushing, and
 *   wait for the next connection event. Continuing down the queue here would
 *   burn every entry's attempt counter against the same dead network.
 * - `drop` — **the server answered** and refused on the merits. Keep retrying a
 *   422 forever and the queue never empties, so the pill says "3 pending" for
 *   the rest of the conference and everyone learns to ignore it. It is dropped
 *   and reported instead.
 *
 * The distinction that matters is whether anything answered. "The server said
 * no" is information; "nothing came back" is the absence of information, and
 * the two must never be collapsed — see the note on `MAX_ATTEMPTS`.
 */
export type AttemptOutcome =
  | { verdict: 'done' }
  | { verdict: 'retry'; reason: string }
  | { verdict: 'drop'; reason: string }

/**
 * How many times a write the server *answered badly* is retried before it is
 * reported and dropped.
 *
 * **This has never applied to a write that got no answer at all, and must not.**
 * It did once, and the bug it caused is the worst this product has had.
 *
 * The flush poll runs every fifteen seconds and makes exactly one attempt on the
 * head of the queue before stopping. So eight attempts against a dead network is
 * a hundred and five seconds — after which the queue *deleted* the entry. Two
 * minutes without signal in a basement committee room, which is the precise
 * scenario the queue exists for and the one written on the landing page, and
 * every check-in and every logistics request in it was destroyed. The only trace
 * was a single dismissable string that named no delegate.
 *
 * A code-0 outcome is not a refusal. Nothing reached the API, so there is no
 * verdict to act on and nothing has been learned by trying. It is retried until
 * the network comes back or the tab is closed, and the queue is in IndexedDB
 * precisely so that closing the tab is not fatal either.
 */
export const MAX_ATTEMPTS = 8

/**
 * Classifies the result of replaying one write.
 *
 * `code` is the `ApiError` code: 0 means the request never reached the API.
 */
export function classifyAttempt(
  outcome: { ok: true } | { ok: false; code: number; message: string },
  attempts: number,
): AttemptOutcome {
  if (outcome.ok) return { verdict: 'done' }

  /*
    Nothing answered. Retry forever — see MAX_ATTEMPTS.

    `attempts` keeps counting, because the pending list uses it to say how long
    something has been waiting, but it can never reach a verdict here.
  */
  if (outcome.code === 0) return { verdict: 'retry', reason: outcome.message }

  /*
    A 401 is a retry, not a drop.

    The session cookie is refreshed by the Edge proxy on a navigation, and a tab
    that has been asleep on a phone in someone's pocket since the morning
    session will get exactly one 401 before that happens. Dropping a check-in
    for that reason loses a delegate who was standing at the desk.
  */
  if (outcome.code === 401 || outcome.code === 429 || outcome.code >= 500) {
    return attempts + 1 >= MAX_ATTEMPTS
      ? { verdict: 'drop', reason: `Gave up after ${MAX_ATTEMPTS} attempts: ${outcome.message}` }
      : { verdict: 'retry', reason: outcome.message }
  }

  return { verdict: 'drop', reason: outcome.message }
}

/** Human-readable age, for the pill and the pending list. */
export function describeAge(queuedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - queuedAt) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return `${hours} h ago`
}
