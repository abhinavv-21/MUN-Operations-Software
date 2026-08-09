import type { ReactNode } from 'react'
import { cn } from '@/lib/utils.ts'

/**
 * A panel on the app canvas.
 *
 * The hairline does the separating and `shadow-raised` — a single 1px of ink at
 * 8% — does the lifting. Both, rather than either: the canvas and the surface
 * are two steps apart in lightness at most, and on a pale seed a bordered card
 * with no shadow at all is a rectangle drawn on paper rather than a card lying
 * on it.
 */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn('rounded-card border border-edge bg-surface shadow-raised p-5 md:p-6', className)}
    >
      {children}
    </section>
  )
}

/**
 * The heading of a panel — deliberately smaller than it was.
 *
 * A screen carries one `PageHeader` at 28px and up to six of these. At `h2`
 * (20px) the six were arguing with the one, and on a dashboard of five small
 * cards the loudest thing on screen was the word "Committees" repeated. At
 * `h3` (16px semibold) it is still a clear step above the 15px body beneath it,
 * the page title is unambiguously the largest thing on the page, and the
 * numbers inside the cards — which are what somebody actually came to read —
 * are no longer the third-largest type in their own panel.
 *
 * The element stays an `<h2>`. The size changed; the outline did not.
 */
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
    <header
      className={cn(
        'mb-4 flex flex-wrap justify-between gap-x-3 gap-y-2',
        // A lone title sits on the same line as its buttons. A title with a
        // description under it is a block, and a button centred against a
        // two-line block floats.
        description ? 'items-start' : 'items-center',
      )}
    >
      <div className="min-w-0">
        <h2 className="text-h3 text-ink">{title}</h2>
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
    <div
      className={cn(
        'flex flex-col rounded-card border bg-surface shadow-raised p-4 md:p-5',
        // The emphasised stat is the one number the screen is about. It gets a
        // tinted edge as well as the accent digits, so it still reads as the
        // headline in greyscale, on a slate theme, and to anyone who cannot
        // separate the accent from the ink.
        emphasis ? 'border-accent/35' : 'border-edge',
      )}
    >
      <p className="text-label uppercase text-ink-secondary">{label}</p>
      <p
        className={cn(
          'mt-1.5 font-heading text-display tabular-nums',
          emphasis ? 'text-accent' : 'text-ink',
        )}
      >
        {value}
      </p>
      {/* Pushed to the floor of the card, so a row of stats where only some
          carry a hint still has its numbers on one line. */}
      {hint ? <p className="mt-auto pt-1.5 text-body-sm text-ink-secondary">{hint}</p> : null}
    </div>
  )
}

/**
 * What a full bar means.
 *
 * `capacity` — the bar is a ceiling. Approaching it is a warning and reaching it
 * is a stop: a committee at 15 of 15 seats can take nobody else.
 *
 * `progress` — the bar is a target. Approaching it is good and reaching it is
 * the point: 96 of 96 delegates marked present is the best possible morning.
 *
 * The same component was doing both, so the attendance register turned amber at
 * 93% marked and red once everybody had arrived — colour asserting the opposite
 * of what had happened.
 */
export type MeterIntent = 'capacity' | 'progress'

export function CapacityMeter({
  filled,
  total,
  label,
  intent = 'capacity',
  unit = 'seats',
}: {
  filled: number
  total: number
  label?: string
  /**
   * What is being counted. Defaults to seats because that is what a committee
   * meter counts — but the register counts delegates marked present, and
   * "6 / 9 seats" on an attendance screen is a sentence about the wrong thing.
   */
  unit?: string
  intent?: MeterIntent
}) {
  const ratio = total > 0 ? filled / total : 0
  const percent = Math.min(100, Math.round(ratio * 100))

  // Colour is a second signal here, never the only one — the count beside it
  // says the same thing in words.
  const tone =
    intent === 'progress'
      ? ratio >= 0.999
        ? 'bg-success'
        : ratio >= 0.6
          ? 'bg-accent'
          : 'bg-warning'
      : ratio >= 1
        ? 'bg-danger'
        : ratio >= 0.8
          ? 'bg-warning'
          : 'bg-success'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        {label ? <span className="truncate text-body-sm text-ink">{label}</span> : null}
        {/* `ml-auto` and not `justify-between` alone: with no label there is
            one child, and `justify-between` puts a single child on the left —
            which left every unlabelled meter in the product with its count
            floating at the wrong end of the bar it describes. */}
        <span className="ml-auto shrink-0 font-mono text-data tabular-nums text-ink-secondary">
          {filled} / {total} {unit}
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
        role="progressbar"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label ? `${label}: ${filled} of ${total} ${unit}` : `${filled} of ${total} ${unit}`}
      >
        <div
          className={cn('h-full rounded-pill transition-all duration-standard ease-standard', tone)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
