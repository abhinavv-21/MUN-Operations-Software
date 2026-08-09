/**
 * The content security policy.
 *
 * Built as a function rather than written as a constant in `next.config.ts`,
 * because a nonce changes per request and because it has to be testable without
 * starting a server — the whole class of bug here is invisible to every check
 * that runs on the server, which is trap 8 all over again in a different suit.
 *
 * ## Why a nonce and not `'unsafe-inline'`
 *
 * Next inlines scripts to bootstrap the client and to stream the RSC payload,
 * and this product inlines one `<style>` block: the theme, written into the
 * first byte so the palette is right with JavaScript disabled. `'unsafe-inline'`
 * would permit all of that and also permit anything an attacker managed to
 * inject — which is the whole thing a CSP is for.
 *
 * A nonce permits exactly the tags we emitted. Next reads it from the
 * `Content-Security-Policy` header on the *request* and stamps it onto its own
 * script tags, which is why the proxy sets the header on the request as well as
 * the response.
 *
 * ## The parts that are not obvious
 *
 * - **`'strict-dynamic'`** lets a nonced script load the chunks it needs
 *   without every hashed filename being listed. Without it the first dynamic
 *   import fails and the app renders but does not hydrate.
 * - **`style-src` takes the nonce; `style-src-attr` takes `'unsafe-inline'`.**
 *   A nonce cannot cover a style *attribute*, and React writes those for the
 *   capacity meters and skeletons. Splitting the two directives means an
 *   injected `<style>` element is still refused while `style="width: 62%"`
 *   keeps working — which matters, because restyling a sign-in form is what
 *   you would do with an injected stylesheet.
 * - **`connect-src` has to include Supabase**, which is the browser's auth
 *   endpoint, and the S3 endpoint, which is where a payment-proof upload is
 *   `PUT` directly from the form.
 * - **`frame-ancestors 'none'`** is the modern `X-Frame-Options: DENY`. Both are
 *   sent, because the header is still what older browsers read.
 * - **No `report-uri`.** A reporting endpoint that nobody reads is a promise to
 *   yourself; the browser console and `scripts/csp-check.mjs` are what actually
 *   catch a violation here.
 */

export interface CspOptions {
  nonce: string
  /** Supabase project origin. Absent in a build with no configuration. */
  supabaseUrl?: string
  /** Backblaze/S3 endpoint for presigned uploads. All five S3 vars may be blank. */
  s3Endpoint?: string
  /** Upstash REST endpoint, called from the server only — never listed here. */
  development?: boolean
}

/** Reduces a URL to a scheme and host, or drops it if it is not one. */
function origin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

export function buildCsp({ nonce, supabaseUrl, s3Endpoint, development = false }: CspOptions): string {
  const supabase = origin(supabaseUrl)
  const storage = origin(s3Endpoint)

  const connect = ["'self'", supabase, storage].filter(Boolean) as string[]

  /*
    Development needs two extra permissions and production must not have them:
    `'unsafe-eval'` for React Refresh, and a websocket for the dev server's HMR
    channel. Gating them on NODE_ENV is what stops a convenience becoming a
    permanent hole — the production policy is the one that ships.
  */
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
  ]

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['script-src', scriptSrc],
    ['style-src', ["'self'", `'nonce-${nonce}'`]],
    /*
      Both halves written out, even though `style-src-elem` would fall back to
      `style-src` on its own.

      The fallback is what made the one real violation here hard to read: the
      header said `style-src` and the browser reported `style-src-elem`, so the
      message named a directive that was not in the policy. Spelling both out
      costs a few bytes and makes the report point at the line that caused it.
    */
    ['style-src-elem', ["'self'", `'nonce-${nonce}'`]],
    // Attributes only — React writes `style="width: 62%"` for the meters.
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...(storage ? [storage] : [])]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', development ? [...connect, 'ws:'] : connect],
    // Nothing in this product is framed, and nothing frames it.
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    // The only form posts are the sign-out and the theme-less auth forms, all
    // same-origin.
    ['form-action', ["'self'"]],
    ['manifest-src', ["'self'"]],
    // The service worker is ours and is served from the root.
    ['worker-src', ["'self'", 'blob:']],
  ]

  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`)

  // Only over HTTPS. On localhost this would upgrade every request to a port
  // that is not listening.
  if (!development) policy.push('upgrade-insecure-requests')

  return policy.join('; ')
}

/**
 * A nonce is 128 bits of randomness, base64-encoded.
 *
 * `crypto.getRandomValues` rather than `node:crypto`, because this runs on the
 * Edge runtime where the Node module is not available.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
