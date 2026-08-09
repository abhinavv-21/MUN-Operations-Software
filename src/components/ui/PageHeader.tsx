import type { ReactNode } from 'react'

/**
 * The rule under the title is the app's one signature element — it is how you
 * know which page you are on, and it is the most visible place the organiser's
 * accent colour appears.
 *
 * Kept as the single piece of decoration in the shell. Everything else earns
 * its place by being information.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-balance text-h1 text-ink">{title}</h1>
        {/* Tight to the title. At `mt-3` the rule read as a divider between the
            title and whatever came next; at `mt-2` it reads as part of the
            title, which is what it is. */}
        <span className="page-rule mt-2" aria-hidden />
      </div>

      {/*
        One wrapping row, ordered rather than stacked, so the two screens want
        different things and get them from the same markup.

        Desktop reads title | actions, then the description on its own full
        width line beneath. On a phone everything is one column, and the source
        order put the buttons between the title and the sentence explaining the
        page — you were offered "Import matrix" before being told what the
        screen was. `order` moves the actions to the foot of the block on small
        screens only, which is also where a thumb is.
      */}
      {actions ? (
        <div className="order-3 flex w-full flex-wrap items-center gap-2 md:order-1 md:w-auto">
          {actions}
        </div>
      ) : null}
      {/*
        The measure lives on the paragraph and the full width lives on the box
        around it. Flexbox breaks lines on an item's hypothetical size, which is
        its base size *after* max-width is applied — so a `w-full max-w-prose`
        paragraph reports 68ch, fits beside the title and the buttons, and never
        wraps to its own line at all. The wrapper has no maximum, so it reports
        100% and takes the line it is entitled to.
      */}
      {description ? (
        <div className="order-2 w-full">
          <p className="max-w-prose text-body text-ink-secondary">{description}</p>
        </div>
      ) : null}
    </header>
  )
}
