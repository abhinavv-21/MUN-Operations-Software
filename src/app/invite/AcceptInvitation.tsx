'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)

    const response = await fetch('/api/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const body = await response.json().catch(() => ({}))

    if (!response.ok) {
      setBusy(false)
      setError(body.error ?? 'Something went wrong')
      return
    }

    router.push(`/app/${body.organizationSlug}`)
    router.refresh()
  }

  return (
    <div className="stack">
      <button type="button" onClick={accept} disabled={busy} className="button">
        {busy ? 'Joining…' : 'Accept invitation'}
      </button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
