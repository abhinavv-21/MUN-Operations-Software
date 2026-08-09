'use client'

/**
 * The offline queue.
 *
 * Dexie over IndexedDB, holding the two writes `policy.ts` allows and nothing
 * else. IndexedDB rather than `localStorage` for one reason that decides it: a
 * check-in queued in a tab that is then closed — or killed by iOS reclaiming
 * memory while the operator is in another app — has to still be there when the
 * tab comes back, and it has to be there without having been serialised through
 * a string.
 *
 * Flushing is driven by three things, deliberately overlapping:
 *
 * - the `online` event, which is the fast path and which browsers lie about;
 * - a poll, because `online` fires on a captive portal that still swallows
 *   every request, and the queue must drain when the network genuinely returns
 *   rather than when the browser first believes it has;
 * - an explicit call after a successful request elsewhere, which is the most
 *   reliable signal of all: something just worked.
 */

import Dexie, { type EntityTable } from 'dexie'
import { ApiError, apiFetch } from '@/lib/api.ts'
import {
  classifyAttempt,
  isQueueable,
  NOT_QUEUEABLE_MESSAGE,
  type QueuedWrite,
  type QueueableKind,
} from './policy.ts'

class OfflineDatabase extends Dexie {
  writes!: EntityTable<QueuedWrite, 'id'>

  constructor() {
    super('mun-ops-offline')
    // `++id` is the auto-incrementing primary key, and its order is the replay
    // order. Two check-ins for one delegate must land in the order they were
    // typed, or the later correction is overwritten by the earlier mistake.
    this.version(1).stores({ writes: '++id, kind, queuedAt' })
  }
}

/**
 * Created lazily.
 *
 * A `new Dexie(...)` at module scope runs during the server render of any
 * component that imports this file, where `indexedDB` does not exist. Dexie
 * tolerates that today and has not always; a getter costs nothing and removes
 * the question.
 */
let database: OfflineDatabase | undefined
function db(): OfflineDatabase {
  database ??= new OfflineDatabase()
  return database
}

export function offlineSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

/* -------------------------------------------------------------------------- */
/* Subscribers                                                                 */
/* -------------------------------------------------------------------------- */

export interface QueueState {
  pending: number
  flushing: boolean
  /** True when the browser says there is no connection. */
  offline: boolean
  /** Set when a write was refused on its merits and dropped. */
  lastDrop: string | null
}

let state: QueueState = { pending: 0, flushing: false, offline: false, lastDrop: null }
const listeners = new Set<(next: QueueState) => void>()

function publish(patch: Partial<QueueState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export function subscribe(listener: (next: QueueState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function queueState(): QueueState {
  return state
}

async function refreshCount(): Promise<void> {
  if (!offlineSupported()) return
  publish({ pending: await db().writes.count() })
}

/* -------------------------------------------------------------------------- */
/* Enqueue                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Sends a write, and queues it only if the request never reached the API.
 *
 * The order is load-bearing: **try first, queue second.** Queueing on
 * `navigator.onLine === false` instead would hold writes back on every browser
 * that reports itself offline while it is not — which is most of them on a
 * captive-portal venue network — and the operator would watch a pill count up
 * while the connection was fine.
 *
 * `code: 0` from `apiFetch` is the only condition that queues. Everything else,
 * including a 422 the operator can fix, is thrown straight back at the form.
 */
export async function sendOrQueue<T>(
  kind: QueueableKind,
  url: string,
  body: unknown,
): Promise<{ sent: true; result: T } | { sent: false }> {
  if (!isQueueable(kind)) throw new Error(`${kind} may not be queued. See src/lib/offline/policy.ts`)

  try {
    const result = await apiFetch<T>(url, { method: 'POST', body })
    // Something just worked, which is a better signal than any event.
    void flush()
    return { sent: true, result }
  } catch (error) {
    if (!(error instanceof ApiError) || !error.isOffline) throw error

    if (!offlineSupported()) {
      throw new ApiError({
        error: `${NOT_QUEUEABLE_MESSAGE} This browser has no offline storage.`,
        code: 0,
      })
    }

    await db().writes.add({
      kind,
      url,
      body,
      queuedAt: Date.now(),
      attempts: 0,
    })
    await refreshCount()
    return { sent: false }
  }
}

/**
 * The fail-fast path for everything that is not one of the two.
 *
 * Called by mutations that must not queue, so the refusal is explicit at the
 * call site rather than implied by the absence of a call.
 */
export function refuseOffline(error: unknown): never {
  if (error instanceof ApiError && error.isOffline) {
    throw new ApiError({ error: NOT_QUEUEABLE_MESSAGE, code: 0 })
  }
  throw error
}

/* -------------------------------------------------------------------------- */
/* Flush                                                                       */
/* -------------------------------------------------------------------------- */

let flushing: Promise<void> | null = null

/**
 * Replays the queue, oldest first, stopping at the first entry that cannot
 * reach the API.
 *
 * Single-flight. Two overlapping flushes would each read the same head entry
 * and send it twice — which the server tolerates, because both writes are
 * idempotent, but which would still double every audit row and make the pill
 * count jump about.
 */
export async function flush(): Promise<void> {
  if (!offlineSupported()) return
  flushing ??= run().finally(() => {
    flushing = null
  })
  return flushing
}

async function run(): Promise<void> {
  publish({ flushing: true })

  try {
    for (;;) {
      const next = await db().writes.orderBy('id').first()
      if (!next) break

      let outcome: { ok: true } | { ok: false; code: number; message: string }
      try {
        await apiFetch(next.url, { method: 'POST', body: next.body })
        outcome = { ok: true }
      } catch (error) {
        outcome =
          error instanceof ApiError
            ? { ok: false, code: error.code, message: error.message }
            : { ok: false, code: 0, message: 'The request could not be sent.' }
      }

      const verdict = classifyAttempt(outcome, next.attempts)

      if (verdict.verdict === 'done') {
        await db().writes.delete(next.id!)
        await refreshCount()
        continue
      }

      if (verdict.verdict === 'drop') {
        await db().writes.delete(next.id!)
        publish({ lastDrop: verdict.reason })
        await refreshCount()
        continue
      }

      // Retry: leave it where it is, count the attempt, and stop. The next
      // connection event or poll picks it up from the same place.
      await db().writes.update(next.id!, {
        attempts: next.attempts + 1,
        lastError: verdict.reason,
      })
      break
    }
  } finally {
    publish({ flushing: false })
    await refreshCount()
  }
}

export async function pendingWrites(): Promise<QueuedWrite[]> {
  if (!offlineSupported()) return []
  return db().writes.orderBy('id').toArray()
}

/** Clears the queue. Only reachable from the pending list, behind a confirm. */
export async function discardQueue(): Promise<void> {
  if (!offlineSupported()) return
  await db().writes.clear()
  await refreshCount()
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/** How often to try the queue while the browser thinks it is offline. */
const POLL_MS = 15_000

let started = false

export function startQueue(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true

  const onOnline = () => {
    publish({ offline: false })
    void flush()
  }
  const onOffline = () => publish({ offline: true })

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  publish({ offline: navigator.onLine === false })
  void refreshCount()
  void flush()

  const timer = window.setInterval(() => {
    // Poll only when there is something to send. An empty queue polling the
    // API every fifteen seconds is a background request per operator per tab
    // for the whole conference, for nothing.
    if (state.pending > 0) void flush()
  }, POLL_MS)

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.clearInterval(timer)
    started = false
  }
}
