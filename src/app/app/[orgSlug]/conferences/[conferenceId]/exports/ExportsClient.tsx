'use client'

import { useState } from 'react'
import { FileSpreadsheet, FileText, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { Input } from '@/components/ui/Field.tsx'

interface Dataset {
  key: string
  label: string
  description: string
  takesDay?: boolean
}

const FORMATS = [
  { key: 'csv', label: 'CSV', icon: Table2, hint: 'Opens anywhere. Full UTF-8.' },
  { key: 'xlsx', label: 'Excel', icon: FileSpreadsheet, hint: 'Column widths and a filter row.' },
  { key: 'pdf', label: 'PDF', icon: FileText, hint: 'For printing. Latin script only.' },
] as const

/**
 * Downloads are plain links, not fetches.
 *
 * A `fetch` here would mean holding the whole file in memory, minting an object
 * URL and synthesising a click — and losing the browser's own progress,
 * cancellation and save dialog on the way. A link with `download` gets all of
 * that for free, and the session cookie rides along because it is same-origin.
 *
 * The PDF hint says "Latin script only" because it is true: the standard-14
 * fonts cannot represent Devanagari or CJK and the exporter writes `?` rather
 * than pretending. Saying so here is what makes the other two formats an
 * informed choice instead of a discovery made after printing.
 */
export function ExportsClient({
  orgSlug,
  conferenceId,
  datasets,
}: {
  orgSlug: string
  conferenceId: string
  datasets: Dataset[]
}) {
  const base = `/api/orgs/${orgSlug}/conferences/${conferenceId}/exports`
  const [day, setDay] = useState('')

  return (
    <div className="flex flex-col gap-4">
      {datasets.map((dataset) => (
        <Card key={dataset.key}>
          <CardHeader title={dataset.label} description={dataset.description} />

          {dataset.takesDay ? (
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="export-day" className="text-label uppercase text-ink-secondary">
                  Day
                </label>
                <Input
                  id="export-day"
                  type="date"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  className="w-44"
                />
              </div>
              <p className="text-body-sm text-ink-secondary">
                {day === ''
                  ? 'Every day on record. Choose a day for a register that also lists who was never marked.'
                  : `The register for ${day}, including delegates with no mark.`}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {FORMATS.map((format) => {
              const query = new URLSearchParams({ format: format.key })
              if (dataset.takesDay && day) query.set('day', day)

              return (
                <Button key={format.key} variant="secondary" asChild>
                  <a href={`${base}/${dataset.key}?${query}`} download>
                    <format.icon size={16} aria-hidden />
                    {format.label}
                  </a>
                </Button>
              )
            })}
          </div>
        </Card>
      ))}

      <p className="text-body-sm text-ink-tertiary">
        Every download is recorded in the audit log with who took it and when. These files hold
        students&rsquo; names, emails and phone numbers.
      </p>
    </div>
  )
}
