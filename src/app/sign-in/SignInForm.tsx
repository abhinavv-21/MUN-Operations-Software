'use client'

import { useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/client.ts'

const ERRORS: Record<string, string> = {
  missing_code: 'That sign-in link was incomplete. Try again.',
  exchange_failed: 'That sign-in link has expired. Request a new one.',
}

export function SignInForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError ? (ERRORS[initialError] ?? null) : null)

  const callback = (path: string) => {
    const url = new URL('/auth/callback', window.location.origin)
    if (path) url.searchParams.set('next', path)
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
      setError('Google sign-in is unavailable right now.')
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
      <p role="status">
        Check <strong>{email}</strong> for a sign-in link. It is valid for one hour.
      </p>
    )
  }

  return (
    <div className="stack">
      <button type="button" onClick={signInWithGoogle} disabled={busy} className="button">
        Continue with Google
      </button>

      <p className="divider">or</p>

      <form onSubmit={signInWithEmail} className="stack">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@school.edu"
        />
        <button type="submit" disabled={busy || email.length === 0} className="button">
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>

      {/* No password field anywhere. Supabase owns credentials, and a magic
          link means there is no password to reset, leak or store. */}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
