'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const BASE = 'inline-flex h-6 items-center gap-1.5 whitespace-nowrap text-body-sm'

/** How long "Saved" stays on screen before the row goes quiet again. */
const SAVED_MS = 4_000

/**
 * Feedback for a control that saves without a submit button.
 *
 * Inline editing removes the moment where a form tells you it worked, so the
 * row has to say so itself. Belongs inside an `aria-live` region so the
 * confirmation is announced and not only shown.
 *
 * **"Saved" expires; "Not saved" does not.** Nothing ever moved the state back
 * to idle, so the green tick stayed beside the Save button for the rest of the
 * session — including after the form had been edited again and genuinely held
 * unsaved changes. A stale confirmation is worse than none: it is the product
 * asserting something untrue about the data in front of you. Success is a
 * momentary acknowledgement and times out on its own. A failure is a standing
 * fact about work that did not land, so it stays until something changes it.
 *
 * Idle renders an empty box of the same height rather than nothing, so the
 * committees screen does not twitch through nine rows every time somebody
 * corrects a seat count.
 */
export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  const [seen, setSeen] = useState(state)
  const [expired, setExpired] = useState(false)

  // Adjusting state during render rather than in an effect: React's own
  // prescribed shape for "reset when a prop changes", and the only one that
  // does not paint a stale tick for a frame first.
  if (seen !== state) {
    setSeen(state)
    setExpired(false)
  }

  useEffect(() => {
    if (state !== 'saved') return
    const timer = setTimeout(() => setExpired(true), SAVED_MS)
    return () => clearTimeout(timer)
  }, [state])

  if (state === 'saving') {
    return (
      <span className={cn(BASE, 'text-ink-secondary', className)}>
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Saving
      </span>
    )
  }

  if (state === 'saved' && !expired) {
    return (
      <span className={cn(BASE, 'text-success', className)}>
        <Check size={14} aria-hidden />
        Saved
      </span>
    )
  }

  if (state === 'error') {
    return (
      <span className={cn(BASE, 'text-danger', className)}>
        <TriangleAlert size={14} aria-hidden />
        Not saved
      </span>
    )
  }

  return <span aria-hidden className={cn(BASE, className)} />
}
