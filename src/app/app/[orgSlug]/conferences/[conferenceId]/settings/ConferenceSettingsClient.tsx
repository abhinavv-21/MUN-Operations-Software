'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Archive, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { Field, Input, Select } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { ErrorState } from '@/components/ui/States.tsx'
import { SaveIndicator, type SaveState } from '@/components/ui/SaveIndicator.tsx'
import { apiFetch, errorMessage } from '@/lib/api.ts'

const STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'] as const
type Status = (typeof STATUSES)[number]

const STATUS_HELP: Record<Status, string> = {
  DRAFT: 'Not yet public. The registration page returns 404.',
  OPEN: 'The registration page accepts applications.',
  CLOSED: 'Public page still resolves, but no new applications are taken.',
  ARCHIVED: 'Finished. Hidden from the public page and frozen for everyone but you.',
}

export interface ConferenceSettings {
  id: string
  name: string
  slug: string
  edition: string | null
  startsOn: string | null
  endsOn: string | null
  venue: string | null
  feeMinorUnits: number | null
  feeCurrency: string | null
  registrationDeadline: string | null
  status: Status
}

/** A `Date` from the API to what an `<input type="date">` wants. */
const asDateInput = (value: string | null) => (value ? value.slice(0, 10) : '')

/**
 * Money is stored in minor units and typed in major ones.
 *
 * `1500.10` in a float eventually prints as `1500.09`, which is why the column
 * is an integer of paise. The conversion has to happen somewhere, and doing it
 * at the one control that reads and writes it keeps every other layer working
 * in whole numbers.
 */
const toMajor = (minor: number | null) => (minor === null ? '' : (minor / 100).toFixed(2))
const toMinor = (major: string): number | null => {
  const trimmed = major.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

export function ConferenceSettingsClient({
  orgSlug,
  conference,
}: {
  orgSlug: string
  conference: ConferenceSettings
}) {
  const router = useRouter()
  const base = `/api/orgs/${orgSlug}/conferences/${conference.id}`

  const [form, setForm] = useState({
    name: conference.name,
    edition: conference.edition ?? '',
    startsOn: asDateInput(conference.startsOn),
    endsOn: asDateInput(conference.endsOn),
    venue: conference.venue ?? '',
    fee: toMajor(conference.feeMinorUnits),
    feeCurrency: conference.feeCurrency ?? '',
    registrationDeadline: asDateInput(conference.registrationDeadline),
    status: conference.status,
  })

  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>, onDone?: () => void) {
    setState('saving')
    setError(null)
    try {
      await apiFetch(base, { method: 'PATCH', body })
      setState('saved')
      onDone?.()
      router.refresh()
    } catch (caught) {
      setState('error')
      setError(errorMessage(caught))
    }
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    void patch({
      name: form.name,
      edition: form.edition.trim() || null,
      startsOn: form.startsOn || null,
      endsOn: form.endsOn || null,
      venue: form.venue.trim() || null,
      feeMinorUnits: toMinor(form.fee),
      feeCurrency: form.feeCurrency.trim() ? form.feeCurrency.trim().toUpperCase() : null,
      registrationDeadline: form.registrationDeadline || null,
      status: form.status,
    })
  }

  async function destroy() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(base, { method: 'DELETE', body: { confirm } })
      // Nothing left to render here, so leave before Next tries to. `push`
      // then `refresh`, because the conference list still holds the row that
      // has just gone.
      router.push(`/app/${orgSlug}/conferences`)
      router.refresh()
    } catch (caught) {
      setDeleting(false)
      setDeleteError(errorMessage(caught))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Details"
          description="What the public registration page says, and when it accepts applications."
        />

        <form onSubmit={save} className="flex flex-col gap-4">
          {error ? <ErrorState message={error} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              )}
            </Field>
            <Field label="Edition" hint="XI, 2026, Spring — whatever you call it.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={form.edition}
                  aria-describedby={describedBy}
                  onChange={(event) => setForm({ ...form, edition: event.target.value })}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts on">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={form.startsOn}
                  onChange={(event) => setForm({ ...form, startsOn: event.target.value })}
                />
              )}
            </Field>
            <Field label="Ends on">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={form.endsOn}
                  onChange={(event) => setForm({ ...form, endsOn: event.target.value })}
                />
              )}
            </Field>
          </div>

          <Field label="Venue">
            {({ id }) => (
              <Input
                id={id}
                value={form.venue}
                onChange={(event) => setForm({ ...form, venue: event.target.value })}
                placeholder="Lucknow Public School, Sector 14"
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Delegate fee" hint="Leave blank if there is none.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={form.fee}
                  aria-describedby={describedBy}
                  onChange={(event) => setForm({ ...form, fee: event.target.value })}
                  placeholder="1500.00"
                />
              )}
            </Field>
            <Field label="Currency" hint="Three letters.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={form.feeCurrency}
                  aria-describedby={describedBy}
                  maxLength={3}
                  onChange={(event) =>
                    setForm({ ...form, feeCurrency: event.target.value.toUpperCase() })
                  }
                  placeholder="INR"
                />
              )}
            </Field>
            <Field label="Registration closes">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={form.registrationDeadline}
                  onChange={(event) =>
                    setForm({ ...form, registrationDeadline: event.target.value })
                  }
                />
              )}
            </Field>
          </div>

          <Field label="Status" hint={STATUS_HELP[form.status]}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={form.status}
                aria-describedby={describedBy}
                onChange={(event) => setForm({ ...form, status: event.target.value as Status })}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.toLowerCase()}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex items-center gap-3">
            <Button type="submit" loading={state === 'saving'}>
              Save
            </Button>
            <span aria-live="polite">
              <SaveIndicator state={state} />
            </span>
          </div>
        </form>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card className="border-danger">
        <CardHeader
          title="Danger zone"
          description="Archiving is reversible. Deleting is not."
        />

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-edge p-4">
            {/* `flex-1` on the text and `shrink-0` on the control, so a long
                description does not push the button onto its own line and make
                two rows of the same shape look like two different components. */}
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-body text-ink">
                {conference.status === 'ARCHIVED' ? 'Reopen this conference' : 'Archive this conference'}
              </p>
              <p className="mt-1 text-body-sm text-ink-secondary">
                {conference.status === 'ARCHIVED'
                  ? 'Puts it back to closed. Nothing was lost while it was archived.'
                  : 'Hides it from the public page and marks it finished. Everything is kept, and you can undo this.'}
              </p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={() =>
                void patch({ status: conference.status === 'ARCHIVED' ? 'CLOSED' : 'ARCHIVED' })
              }
            >
              <Archive size={16} aria-hidden />
              {conference.status === 'ARCHIVED' ? 'Reopen' : 'Archive'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger p-4">
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-body text-ink">Delete this conference</p>
              <p className="mt-1 text-body-sm text-ink-secondary">
                Every committee, delegate, allocation, registration, attendance mark, logistics
                request and award goes with it. The audit log does not — it stays on the
                organisation, including the record of this deletion.
              </p>
            </div>
            <Button variant="destructive" className="shrink-0" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={16} aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) {
            setConfirm('')
            setDeleteError(null)
          }
        }}
        title="Delete this conference"
        holdsInput
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={deleting}
              // The button is guarded here and the confirmation is checked
              // again on the server, because a disabled button is not a
              // control — it is a suggestion that `curl` ignores.
              disabled={confirm !== conference.name}
              onClick={() => void destroy()}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {deleteError ? <ErrorState message={deleteError} /> : null}

          <div
            role="alert"
            className="flex items-start gap-3 rounded-card border border-danger bg-danger-wash p-4"
          >
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            <p className="text-body-sm text-ink">
              This cannot be undone. If the conference is finished, archive it instead — archiving
              keeps everything and can be reversed.
            </p>
          </div>

          <Field label={`Type "${conference.name}" to confirm`} required>
            {({ id }) => (
              <Input
                id={id}
                value={confirm}
                autoComplete="off"
                onChange={(event) => setConfirm(event.target.value)}
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  )
}
