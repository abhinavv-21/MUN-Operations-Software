import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Feedback for a control that saves without a submit button.
 *
 * Inline editing removes the moment where a form tells you it worked, so the
 * row has to say so itself. Belongs inside an `aria-live` region so the
 * confirmation is announced and not only shown.
 */
export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  if (state === 'saving') {
    return (
      <span className={cn('flex items-center gap-1.5 text-body-sm text-ink-secondary', className)}>
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Saving
      </span>
    )
  }

  if (state === 'saved') {
    return (
      <span className={cn('flex items-center gap-1.5 text-body-sm text-success', className)}>
        <Check size={14} aria-hidden />
        Saved
      </span>
    )
  }

  if (state === 'error') {
    return (
      <span className={cn('flex items-center gap-1.5 text-body-sm text-danger', className)}>
        <TriangleAlert size={14} aria-hidden />
        Not saved
      </span>
    )
  }

  return null
}
