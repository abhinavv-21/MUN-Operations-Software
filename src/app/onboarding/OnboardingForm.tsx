'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { Field, Input } from '@/components/ui/Field.tsx'
import { apiFetch, errorMessage } from '@/lib/api.ts'
import { supabaseBrowser } from '@/lib/supabase/client.ts'

/**
 * The step everyone completes once, whichever way they signed in.
 *
 * Google gives us a name and an email and never a phone, an address or a
 * password, so an account created through it is half a profile. Requiring the
 * rest here is what makes the two routes produce the same thing — including a
 * password, so nobody is locked out of their own organisation the day their
 * Google account is unavailable.
 */
export function OnboardingForm({
  needsPassword,
  initial,
}: {
  needsPassword: boolean
  initial: {
    firstName: string
    lastName: string
    phone: string
    address: string
    organizationName: string
    needsOrganization: boolean
  }
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName)
  const [phone, setPhone] = useState(initial.phone)
  const [address, setAddress] = useState(initial.address)
  const [organizationName, setOrganizationName] = useState(initial.organizationName)
  const [password, setPassword] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      if (needsPassword) {
        // Adds an email identity alongside Google, so this account can sign in
        // either way from now on. Done from the browser because Supabase owns
        // the credential and it never passes through our server.
        const { error: passwordError } = await supabaseBrowser().auth.updateUser({ password })
        if (passwordError) {
          setError(passwordError.message || 'Could not set that password.')
          return
        }
      }

      const body = await apiFetch<{ organizationSlug: string | null }>('/api/onboarding', {
        method: 'POST',
        body: { firstName, lastName, phone, address, organizationName },
      })

      router.push((body.organizationSlug ? `/app/${body.organizationSlug}` : '/app') as never)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save that. Try again in a moment.'))
    } finally {
      // In a finally, so a throw can never strand the button.
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="First name" required>
          {({ id }) => (
            <Input
              id={id}
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Last name" required>
          {({ id }) => (
            <Input
              id={id}
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          )}
        </Field>
      </div>

      {initial.needsOrganization ? (
        <Field label="Organisation" hint="Your society or school. You can rename it later." required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              required
              autoComplete="organization"
              aria-describedby={describedBy}
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Lucknow Public School Model UN"
            />
          )}
        </Field>
      ) : null}

      <Field label="Contact number" hint="Used by your team on the day, not by us." required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="tel"
            required
            autoComplete="tel"
            aria-describedby={describedBy}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>

      <Field label="Address" required>
        {({ id }) => (
          <Input
            id={id}
            required
            autoComplete="street-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        )}
      </Field>

      {needsPassword ? (
        <Field
          label="Set a password"
          hint="So you can still get in if Google is unavailable. At least 8 characters."
          required
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              aria-describedby={describedBy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      <div>
        <Button
          type="submit"
          loading={busy}
          disabled={
            firstName.trim() === '' ||
            lastName.trim() === '' ||
            phone.trim() === '' ||
            address.trim() === '' ||
            (initial.needsOrganization && organizationName.trim() === '') ||
            (needsPassword && password.length < 8)
          }
        >
          Finish setting up
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}
