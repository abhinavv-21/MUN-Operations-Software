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
    <header className="mb-6 md:mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-h1 text-ink">{title}</h1>
          <span className="page-rule mt-3" aria-hidden />
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-4 max-w-prose text-body text-ink-secondary">{description}</p>
      ) : null}
    </header>
  )
}
