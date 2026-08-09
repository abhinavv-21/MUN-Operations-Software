'use client'

import { useSyncExternalStore } from 'react'
import { queueState, startQueue, subscribe, type QueueState } from './queue.ts'

/**
 * A frozen snapshot for the server render.
 *
 * `useSyncExternalStore` calls `getServerSnapshot` during SSR and hydration and
 * compares it by reference, so it has to be one object created once. Building
 * it inside the function is the classic infinite-render bug.
 */
const SERVER_STATE: QueueState = { pending: 0, flushing: false, offline: false, lastDrop: null }

export function useOfflineQueue(): QueueState {
  return useSyncExternalStore(subscribe, queueState, () => SERVER_STATE)
}

export { startQueue }
