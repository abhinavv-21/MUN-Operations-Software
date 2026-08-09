import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Lock, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from './Button.tsx'
import { cn } from '@/lib/utils.ts'

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Skeleton rows match the final row height, so data landing never shifts the
 * layout. A centred spinner for table content is forbidden: it tells you
 * something is happening and nothing about what is arriving.
 */
export function SkeletonRows({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex h-row-mobile items-center gap-4 border-b border-edge px-4 md:h-row"
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <div
              key={columnIndex}
              className="skeleton h-3.5"
              style={{
                width: columnIndex === 0 ? '28%' : `${Math.max(12, 20 - columnIndex * 2)}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-card border border-edge bg-surface p-5">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton mt-3 h-9 w-16" />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty                                                                       */
/* -------------------------------------------------------------------------- */

/** An empty screen is an invitation to act, so it always offers the action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-16 text-center',
        className,
      )}
    >
      <Icon size={32} className="text-ink-tertiary" aria-hidden />
      <h3 className="mt-4 text-h3 text-ink">{title}</h3>
      <p className="mt-1 max-w-prose text-body-sm text-ink-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Error                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Errors explain what happened and what to do. They do not apologise and they
 * are never vague.
 *
 * `offline` gets its own icon and heading because "check your connection" and
 * "this failed" call for different actions from the reader.
 */
export function ErrorState({
  message,
  offline = false,
  onRetry,
}: {
  message: string
  offline?: boolean
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-danger bg-danger-wash p-5 sm:flex-row sm:items-center"
    >
      {offline ? (
        <WifiOff size={20} className="shrink-0 text-danger" aria-hidden />
      ) : (
        <AlertTriangle size={20} className="shrink-0 text-danger" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-h3 text-ink">{offline ? 'No connection' : 'Could not load this'}</p>
        <p className="mt-1 text-body-sm text-ink-secondary">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  )
}

/**
 * For a whole surface outside the current role's scope.
 *
 * Individual admin controls are omitted rather than disabled — a disabled
 * button is a promise you cannot keep. Server-side authorization remains the
 * real boundary; this is only what the person sees.
 */
export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="Not available on your account"
      description={`${what} is managed by an organisation admin. Ask one if you need access.`}
    />
  )
}
