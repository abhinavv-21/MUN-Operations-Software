'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Field, Input } from '@/components/ui/Field.tsx'
import { apiFetch, errorMessage } from '@/lib/api.ts'
import { supabaseBrowser } from '@/lib/supabase/client.ts'

const ERRORS: Record<string, string> = {
  missing_code: 'That sign-in link was incomplete. Try again.',
  exchange_failed: 'That link has expired. Sign in again.',
}

type Step = 'email' | 'password' | 'create' | 'confirm'

/**
 * Two steps: the address first, then either a password or a sign-up.
 *
 * This asks the server whether an address has an account, which is an
 * enumeration oracle and a deliberate, accepted trade — it is what Google and
 * Microsoft do, and the alternative is making an organiser guess whether they
 * are signing in or signing up. The lookup is rate limited hard.
 */
export function SignInForm({ next, initialError }: { next?: string; initialError?: string }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    initialError ? (ERRORS[initialError] ?? null) : null,
  )

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  const destination = next ?? '/app'

  const callback = () => {
    const url = new URL('/auth/callback', window.location.origin)
    url.searchParams.set('next', destination)
    return url.toString()
  }

  async function continueWithEmail(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const { exists } = await apiFetch<{ exists: boolean }>('/api/auth/check-email', {
        method: 'POST',
        body: { email },
      })
      setStep(exists ? 'password' : 'create')
    } catch (caught) {
      setError(errorMessage(caught, 'Could not continue. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({
      email,
      password,
    })
    setBusy(false)

    if (signInError) {
      // Deliberately does not distinguish a wrong password from an unconfirmed
      // account beyond what the person needs to act: both mean "you cannot get
      // in yet", and one of them is a hint worth giving.
      setError(
        signInError.message.toLowerCase().includes('confirm')
          ? 'Confirm your email address first. Check your inbox for the link we sent.'
          : 'That password is not right.',
      )
      return
    }

    router.push(destination as never)
    router.refresh()
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const { error: signUpError } = await supabaseBrowser().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: callback(),
        // Carried in the token's metadata, so the first authenticated request
        // can write a complete profile row without a second round trip.
        data: {
          first_name: firstName,
          last_name: lastName,
          full_name: [firstName, lastName].filter(Boolean).join(' '),
          phone,
          address,
          organization_name: organizationName,
        },
      },
    })
    setBusy(false)

    if (signUpError) {
      setError(signUpError.message || 'Could not create that account.')
      return
    }

    setStep('confirm')
  }

  async function signInWithGoogle() {
    setBusy(true)
    setError(null)
    const { error: oauthError } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback() },
    })
    if (oauthError) {
      setError('Google sign-in is unavailable right now.')
      setBusy(false)
    }
  }

  if (step === 'confirm') {
    return (
      <div role="status" className="rounded-card border border-edge bg-accent-wash p-5">
        <Mail size={20} className="text-accent" aria-hidden />
        <h2 className="mt-2 font-heading text-h3 text-ink">Confirm your email</h2>
        <p className="mt-1 text-body text-ink-secondary">
          We sent a link to <strong className="text-ink">{email}</strong>. Open it and you will be
          signed in. You only have to do this once.
        </p>
      </div>
    )
  }

  const back = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        setStep('email')
        setPassword('')
        setError(null)
      }}
    >
      <ArrowLeft size={16} aria-hidden />
      {email}
    </Button>
  )

  return (
    <div className="flex flex-col gap-5">
      {step === 'email' ? (
        <>
          <Button variant="secondary" onClick={signInWithGoogle} disabled={busy}>
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image
                does not process SVG unless `dangerouslyAllowSVG` is on, which
                would apply to every remote image the product renders. */}
            <img src="/google.svg" alt="" width={18} height={18} aria-hidden />
            Continue with Google
          </Button>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-edge" />
            <span className="text-label uppercase text-ink-tertiary">or</span>
            <span className="h-px flex-1 bg-edge" />
          </div>

          <form onSubmit={continueWithEmail} className="flex flex-col gap-4">
            <Field label="Email address" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@school.edu"
                />
              )}
            </Field>
            <Button type="submit" loading={busy} disabled={email.length === 0}>
              Continue
            </Button>
          </form>
        </>
      ) : null}

      {step === 'password' ? (
        <form onSubmit={signIn} className="flex flex-col gap-4">
          <div>{back}</div>
          <Field label="Password" required>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={busy} disabled={password.length === 0}>
            Sign in
          </Button>
        </form>
      ) : null}

      {step === 'create' ? (
        <form onSubmit={createAccount} className="flex flex-col gap-4">
          <div>{back}</div>
          <p className="text-body-sm text-ink-secondary">
            No account yet for that address. Create one — you will be the owner of your
            organisation.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="First name" required>
              {({ id }) => (
                <Input
                  id={id}
                  required
                  autoFocus
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

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Contact number">
              {({ id }) => (
                <Input
                  id={id}
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              )}
            </Field>
            <Field label="Address">
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="street-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Password" hint="At least 8 characters." required>
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

          <Button
            type="submit"
            loading={busy}
            disabled={
              firstName.trim() === '' ||
              lastName.trim() === '' ||
              organizationName.trim() === '' ||
              password.length < 8
            }
          >
            Create account
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
