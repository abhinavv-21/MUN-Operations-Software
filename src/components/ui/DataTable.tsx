import type { ReactNode } from 'react'
import { cn } from '@/lib/utils.ts'

export interface Column<Row> {
  key: string
  header: string
  /** Right-aligned and tabular for anything numeric. */
  numeric?: boolean
  /** Hidden below md. Use for anything that is not identifying. */
  secondary?: boolean
  render: (row: Row) => ReactNode
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
    <div className={cn('table-scroll rounded-card border border-edge bg-surface', className)}>
      <table className="w-full border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-edge">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-label uppercase text-ink-secondary',
                  column.numeric ? 'text-right' : 'text-left',
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
              className="border-b border-edge last:border-b-0 hover:bg-surface-sunken"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-4 py-3 align-middle text-ink',
                    column.numeric ? 'text-right font-mono tabular-nums' : '',
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
