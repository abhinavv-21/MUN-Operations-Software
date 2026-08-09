/**
 * The two public Supabase values, read once and validated.
 *
 * **These must be written as literal `process.env.NEXT_PUBLIC_…` expressions.**
 *
 * Next.js inlines client-side environment variables by textually replacing
 * exactly that form during the build. A computed read — `process.env[name]`
 * inside a helper — cannot be replaced, so it compiles to a lookup on an object
 * that is empty in the browser. Both values came back `undefined`, the client
 * factory threw before any `await`, and every sign-in button span forever with
 * no error: the throw happened before the code that would have cleared the
 * spinner, and there was nothing in the bundle to grep for.
 *
 * On the server the computed form works fine, which is why this survived every
 * test and the build.
 *
 * The URL must be the project root with no path. The client appends `/auth/v1`,
 * `/rest/v1` and `/storage/v1` itself, so a value ending in `/rest/v1` produces
 * requests to `/rest/v1/auth/v1/token` that fail in a way that looks like an
 * auth bug rather than a configuration one.
 */

const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const RAW_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is not set. In the browser this means it was missing when the app was built, ` +
        `not when it was started — set it in the deployment's environment and rebuild.`,
    )
  }
  return value
}

export function supabaseUrl(): string {
  const url = required(RAW_URL, 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '')
  if (/\/(rest|auth|storage)\/v1$/.test(url)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be the project root, not "${url}". ` +
        `The client appends the service path itself.`,
    )
  }
  return url
}

export function supabaseAnonKey(): string {
  return required(RAW_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

/** Where `jose` fetches the signing keys from. */
export function jwksUrl(): URL {
  return new URL(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`)
}

/** The `iss` every access token must carry. */
export function tokenIssuer(): string {
  return `${supabaseUrl()}/auth/v1`
}
