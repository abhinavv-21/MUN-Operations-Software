'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button.tsx'

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
    <div className="mt-6 flex flex-col gap-3">
      <Button onClick={accept} loading={busy}>
        Accept invitation
      </Button>
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
