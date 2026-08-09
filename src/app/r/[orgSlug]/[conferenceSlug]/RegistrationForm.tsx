'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Field, Input, Textarea } from '@/components/ui/Field.tsx'
import { apiFetch, errorMessage } from '@/lib/api.ts'

export function RegistrationForm({
  orgSlug,
  conferenceSlug,
  deadline,
}: {
  orgSlug: string
  conferenceSlug: string
  deadline: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const text = (key: string) => {
      const value = form.get(key)
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
    }
    const count = (key: string) => {
      const value = text(key)
      return value === null ? null : Number(value)
    }

    try {
      const body = await apiFetch<{ status: string; reference: string }>(
        `/api/public/${orgSlug}/${conferenceSlug}/register`,
        {
          method: 'POST',
          body: {
            fullName: text('fullName'),
            email: text('email'),
            phone: text('phone'),
            schoolName: text('schoolName'),
            grade: text('grade'),
            committeePreference: text('committeePreference'),
            committeePreference2: text('committeePreference2'),
            munsAttended: count('munsAttended'),
            awardsWon: count('awardsWon'),
            dietaryNotes: text('dietaryNotes'),
            accessibilityNotes: text('accessibilityNotes'),
            // The trap. Never focusable, never announced, never filled by a
            // person — so anything in it came from a script.
            hp_website: text('hp_website') ?? '',
          },
        },
      )
      setReference(body.reference)
    } catch (caught) {
      setError(errorMessage(caught, 'We could not accept that. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  if (reference) {
    return (
      <div role="status">
        <CheckCircle2 size={28} className="text-success" aria-hidden />
        <h2 className="mt-3 font-heading text-h2 text-ink">Application received</h2>
        <p className="mt-2 text-body text-ink-secondary">
          Keep this reference. Quote it if you contact the organisers.
        </p>
        <p className="mt-4 rounded-control border border-edge bg-surface-sunken px-4 py-3 font-mono text-h3 tracking-wide text-ink">
          {reference}
        </p>
        <p className="mt-4 text-body-sm text-ink-secondary">
          {/* Deliberately says nothing about payment: uploads are unavailable
              until storage is configured, and thanking someone for a screenshot
              that never arrived is a support ticket. */}
          The organisers review applications by hand and will be in touch. There is nothing
          further to do now.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-h2 text-ink">Register as a delegate</h2>
        {deadline ? (
          <p className="mt-1 text-body-sm text-ink-secondary">
            Applications close{' '}
            {new Date(deadline).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
            .
          </p>
        ) : null}
      </div>

      <Field label="Full name" required>
        {({ id }) => <Input id={id} name="fullName" required autoComplete="name" />}
      </Field>

      <Field label="Email address" hint="Where the organisers will reach you." required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Contact number">
          {({ id }) => <Input id={id} name="phone" type="tel" autoComplete="tel" />}
        </Field>
        <Field label="School or institution">
          {({ id }) => <Input id={id} name="schoolName" autoComplete="organization" />}
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Year or grade">{({ id }) => <Input id={id} name="grade" />}</Field>
        <Field label="MUNs attended">
          {({ id }) => <Input id={id} name="munsAttended" type="number" min={0} max={200} />}
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="First committee preference"
          hint="A preference, not a placement — the secretariat allocates."
        >
          {({ id, describedBy }) => (
            <Input id={id} name="committeePreference" aria-describedby={describedBy} />
          )}
        </Field>
        <Field label="Second committee preference">
          {({ id }) => <Input id={id} name="committeePreference2" />}
        </Field>
      </div>

      <Field label="Dietary requirements">
        {({ id }) => <Textarea id={id} name="dietaryNotes" rows={2} />}
      </Field>

      <Field label="Accessibility requirements">
        {({ id }) => <Textarea id={id} name="accessibilityNotes" rows={2} />}
      </Field>

      {/*
        The honeypot.

        Hidden from sight, from the tab order and from screen readers, and given
        a name a naive bot will want to fill. `aria-hidden` plus `tabIndex={-1}`
        plus `autoComplete="off"` is what keeps a password manager and a human
        away from it; `display: none` alone is something bots check for.
      */}
      <div className="hidden" aria-hidden>
        <label htmlFor="hp_website">Website</label>
        <input id="hp_website" name="hp_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={busy}>
          Submit application
        </Button>
      </div>
    </form>
  )
}
