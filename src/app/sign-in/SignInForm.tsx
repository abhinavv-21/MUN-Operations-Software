'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Field, Input } from '@/components/ui/Field.tsx'
import { supabaseBrowser } from '@/lib/supabase/client.ts'

const ERRORS: Record<string, string> = {
  missing_code: 'That sign-in link was incomplete. Request a new one.',
  exchange_failed: 'That sign-in link has expired. Request a new one.',
}

export function SignInForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    initialError ? (ERRORS[initialError] ?? null) : null,
  )

  const callback = (path: string) => {
    const url = new URL('/auth/callback', window.location.origin)
    url.searchParams.set('next', path)
    return url.toString()
  }

  async function signInWithGoogle() {
    setBusy(true)
    setError(null)
    const { error: oauthError } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback(next ?? '/app') },
    })
    if (oauthError) {
      setError('Google sign-in is unavailable right now. Use an email link instead.')
      setBusy(false)
    }
  }

  async function signInWithEmail(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const { error: linkError } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback(next ?? '/app') },
    })

    setBusy(false)
    // Answered the same way whether or not the address has an account. Saying
    // "no account with that email" turns this form into a way to ask whether a
    // given person uses the product.
    if (linkError) setError('Could not send the link. Check the address and try again.')
    else setSent(true)
  }

  if (sent) {
    return (
      <div role="status" className="rounded-card border border-edge bg-accent-wash p-5">
        <Mail size={20} className="text-accent" aria-hidden />
        <p className="mt-2 text-body text-ink">
          Check <strong>{email}</strong> for a sign-in link.
        </p>
        <p className="mt-1 text-body-sm text-ink-secondary">It is valid for one hour.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <Button variant="secondary" onClick={signInWithGoogle} disabled={busy}>
        Continue with Google
      </Button>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-edge" />
        <span className="text-label uppercase text-ink-tertiary">or</span>
        <span className="h-px flex-1 bg-edge" />
      </div>

      <form onSubmit={signInWithEmail} className="flex flex-col gap-4">
        <Field label="Email address" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              required
              autoComplete="email"
              value={email}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@school.edu"
            />
          )}
        </Field>

        {/* No password field anywhere. Supabase owns credentials, and a magic
            link means there is no password to reset, leak or store. */}
        <Button type="submit" loading={busy} disabled={email.length === 0}>
          Email me a sign-in link
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
