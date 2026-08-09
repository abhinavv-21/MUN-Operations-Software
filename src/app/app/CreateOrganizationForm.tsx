'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { Field, Input } from '@/components/ui/Field.tsx'

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

    const body = await response.json().catch(() => ({}))
    setBusy(false)

    if (!response.ok) {
      // Every failure is { error, code, details? }, so one branch reads them
      // all. A 422 carries [{ path, message }] from the validator.
      const detail = Array.isArray(body.details) ? body.details[0]?.message : undefined
      setError(detail ?? body.error ?? 'Something went wrong')
      return
    }

    router.push(`/app/${body.organization.slug}`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Name" required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            required
            value={name}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(event) => setName(event.target.value)}
            placeholder="Lucknow Public School Model UN"
          />
        )}
      </Field>

      <Field
        label="Address"
        hint={`Your conferences will live at /app/${effectiveSlug || 'your-address'}`}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            required
            value={effectiveSlug}
            aria-describedby={describedBy}
            onChange={(event) => {
              setSlugTouched(true)
              setSlug(event.target.value)
            }}
            placeholder="lps-mun"
          />
        )}
      </Field>

      <div>
        <Button type="submit" loading={busy} disabled={name.length < 2}>
          Create organisation
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
