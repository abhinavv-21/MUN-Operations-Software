'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Mirrors `suggestSlug` on the server. The server value is authoritative. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function CreateOrganizationForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSlug = slugTouched ? slug : slugify(name)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const response = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, slug: effectiveSlug }),
    })

    const body = await response.json()
    setBusy(false)

    if (!response.ok) {
      // Every failure is { error, code, details? }, so one branch reads them
      // all. 422 carries [{ path, message }] from the validator.
      const detail = Array.isArray(body.details) ? body.details[0]?.message : undefined
      setError(detail ?? body.error ?? 'Something went wrong')
      return
    }

    router.push(`/app/${body.organization.slug}`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="stack">
      <label htmlFor="org-name">Name</label>
      <input
        id="org-name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Lucknow Public School Model UN"
      />

      <label htmlFor="org-slug">Address</label>
      <input
        id="org-slug"
        required
        value={effectiveSlug}
        onChange={(event) => {
          setSlugTouched(true)
          setSlug(event.target.value)
        }}
        placeholder="lps-mun"
      />
      <p className="muted">
        Your conferences will live at <code>/app/{effectiveSlug || 'your-address'}</code>.
      </p>

      <button type="submit" disabled={busy || name.length < 2} className="button">
        {busy ? 'Creating…' : 'Create organisation'}
      </button>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </form>
  )
}
