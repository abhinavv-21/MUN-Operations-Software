import type { ReactNode } from 'react'
import { cn } from '@/lib/utils.ts'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-card border border-edge bg-surface p-5 md:p-6', className)}>
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-h2 text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-prose text-body-sm text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Stat({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string
  value: number | string
  hint?: string
  /** At most one stat per view carries the accent. Two competing is none. */
  emphasis?: boolean
}) {
  return (
    <div className="rounded-card border border-edge bg-surface p-5">
      <p className="text-label uppercase text-ink-secondary">{label}</p>
      <p
        className={cn(
          'mt-2 font-heading text-display tabular-nums',
          emphasis ? 'text-accent' : 'text-ink',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-body-sm text-ink-secondary">{hint}</p> : null}
    </div>
  )
}

export function CapacityMeter({
  filled,
  total,
  label,
}: {
  filled: number
  total: number
  label?: string
}) {
  const ratio = total > 0 ? filled / total : 0
  const percent = Math.min(100, Math.round(ratio * 100))

  // Colour is a second signal here, never the only one — the count beside it
  // says the same thing in words.
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warning' : 'bg-success'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        {label ? <span className="text-body-sm text-ink-secondary">{label}</span> : null}
        <span className="font-mono text-data tabular-nums text-ink-secondary">
          {filled} / {total} seats
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
        role="progressbar"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label ? `${label} seat capacity` : 'Seat capacity'}
      >
        <div
          className={cn('h-full rounded-pill transition-all duration-standard ease-standard', tone)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
