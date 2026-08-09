import type { ReactNode } from 'react'
import { cn } from '@/lib/utils.ts'

export interface Column<Row> {
  key: string
  header: string
  /** Right-aligned and tabular for anything numeric. */
  numeric?: boolean
  /**
   * Right-aligns the header without the mono/tabular treatment `numeric`
   * brings.
   *
   * For the trailing actions column, which every editable table in the product
   * renders as a `flex justify-end` of icon buttons while leaving its header
   * flush left — so "Actions" sits at the far side of the table from the
   * buttons it names. `numeric` implies this.
   */
  align?: 'left' | 'right'
  /** Hidden below md. Use for anything that is not identifying. */
  secondary?: boolean
  render: (row: Row) => ReactNode
}

/**
 * Cell rhythm, shared with `SkeletonRows` so the two cannot drift.
 *
 * The outer columns are inset to `pl-5 md:pl-6` rather than the `px-4 md:px-5`
 * the inner ones use, because a table almost always sits inside a `Card` that
 * has been flattened to `p-0` — and a first column that starts 4px from the
 * card edge does not line up with the card's own heading 24px above it. Making
 * the two agree is the difference between a table dropped into a card and a
 * table that belongs to it.
 */
export const CELL_X = 'px-4 first:pl-5 last:pr-5 md:px-5 md:first:pl-6 md:last:pr-6'

/**
 * Scroll shadows, in CSS alone.
 *
 * At 390px a five-column table is wider than the phone, and the container
 * clipped it dead at the edge — a delegate's country reading "Franc" with
 * nothing to say the rest of it was one swipe away. It looks like a rendering
 * fault rather than an invitation.
 *
 * Four background layers do it with no JavaScript and no measurement. The two
 * `local` layers are painted in the surface colour and scroll *with* the
 * content; the two `scroll` layers are soft shadows fixed to the container.
 * While the table is scrolled hard against an edge, that edge's cover sits over
 * its shadow and hides it; scroll away and the cover travels off and the shadow
 * appears. A table that fits has both covers parked over both shadows forever,
 * so there is nothing to hide and nothing to hide it with — the affordance is
 * present exactly when it is true.
 *
 * A style attribute rather than a class: the CSP forbids `<style>` in a client
 * component, and this is four layers of gradient that no utility expresses.
 */
const SCROLL_SHADOWS = {
  background: [
    'linear-gradient(to right, var(--color-surface) 40%, transparent) 0 0 / 36px 100% no-repeat local',
    'linear-gradient(to left, var(--color-surface) 40%, transparent) 100% 0 / 36px 100% no-repeat local',
    'linear-gradient(to right, color-mix(in oklab, var(--color-ink) 13%, transparent), transparent) 0 0 / 14px 100% no-repeat scroll',
    'linear-gradient(to left, color-mix(in oklab, var(--color-ink) 13%, transparent), transparent) 100% 0 / 14px 100% no-repeat scroll',
    'var(--color-surface)',
  ].join(','),
}

/**
 * The operations table.
 *
 * Horizontal scroll lives inside this container and never on the body — a page
 * that scrolls sideways on a phone is how a check-in screen becomes unusable
 * while someone holds a queue up.
 *
 * A caption is rendered for screen readers rather than a bare `<table>`, and
 * every header carries a scope, because this is the component an organiser will
 * be reading from all day.
 *
 * Three decisions worth stating, because this component carries seven screens:
 *
 * **A header band, not a header rule.** The head sits on `surface-sunken` under
 * a `border-edge-strong`, so a table that runs past the fold still declares
 * where it starts. Everything between rows stays a hairline, so the band is the
 * only heavy line in the component.
 *
 * **A row is at least `--spacing-row` tall, never exactly.** `height` on a
 * `<tr>` behaves as a minimum, so a one-line row gets a comfortable 52px and a
 * two-line row (name over email, which three screens render) grows instead of
 * being crushed. This is also the number `SkeletonRows` uses, which is what
 * makes "skeletons match the final row height" true rather than aspirational.
 *
 * **No zebra.** Ninety-six alternating bands is a texture, and it fights the
 * badges and meters the rows actually carry. The row highlight is tied to
 * pointer and keyboard instead, so the row you are acting on is the one that
 * lights up — including when focus lands on a button inside it.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  className,
}: {
  caption: string
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  empty?: ReactNode
  className?: string
}) {
  if (rows.length === 0 && empty) {
    return <div className="rounded-card border border-edge bg-surface">{empty}</div>
  }

  return (
    <div
      style={SCROLL_SHADOWS}
      className={cn('table-scroll rounded-card border border-edge bg-surface', className)}
    >
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="h-11 border-b border-edge-strong bg-surface-sunken">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  CELL_X,
                  'text-label uppercase text-ink-secondary',
                  column.numeric || column.align === 'right' ? 'text-right' : 'text-left',
                  column.secondary ? 'hidden md:table-cell' : '',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                'h-row-mobile border-b border-edge last:border-b-0 md:h-row',
                'transition-colors duration-micro ease-standard',
                // Pointer, touch and keyboard all light the same row. The
                // focus-within case is the one that matters on the desk: the
                // action buttons live in the last column, and tabbing to one
                // with no idea which row it belongs to is how the wrong
                // delegate gets marked absent.
                'hover:bg-accent-wash focus-within:bg-accent-wash active:bg-accent-wash',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    CELL_X,
                    'py-2.5 align-middle text-ink',
                    column.numeric ? 'text-right font-mono tabular-nums' : '',
                    !column.numeric && column.align === 'right' ? 'text-right' : '',
                    column.secondary ? 'hidden md:table-cell' : '',
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
