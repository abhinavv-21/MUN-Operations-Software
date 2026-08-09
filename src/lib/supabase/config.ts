/**
 * The two public Supabase values, read once and validated.
 *
 * The URL must be the project root with no path. The client appends `/auth/v1`,
 * `/rest/v1` and `/storage/v1` itself, so a value ending in `/rest/v1` produces
 * requests to `/rest/v1/auth/v1/token` that fail in a way that looks like an
 * auth bug rather than a configuration one.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`)
  }
  return value
}

export function supabaseUrl(): string {
  const url = required('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '')
  if (/\/(rest|auth|storage)\/v1$/.test(url)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be the project root, not "${url}". ` +
        `The client appends the service path itself.`,
    )
  }
  return url
}

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

/** Where `jose` fetches the signing keys from. */
export function jwksUrl(): URL {
  return new URL(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`)
}

/** The `iss` every access token must carry. */
export function tokenIssuer(): string {
  return `${supabaseUrl()}/auth/v1`
}
