import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, generateNonce } from '@/lib/csp.ts'

/**
 * Refreshes the Supabase session cookie, and sets the content security policy.
 *
 * Named `proxy` rather than `middleware`: Next 16.3 renamed the convention and
 * warns on the old one at build time.
 *
 * This runs on the Edge runtime, so it must never import Prisma — no database
 * client, no `@/server/*`, nothing that reaches for a TCP socket. Authorization
 * decisions belong in the service layer, where Server Components hit them too;
 * a check placed here would be a check that a Server Component never runs.
 *
 * `getClaims()` rather than `getUser()`: it verifies the token locally against
 * the project's JWKS and only calls Supabase when the token has actually
 * expired and needs exchanging. `getUser()` is a network round trip on every
 * single request, including the ones for a session that is perfectly valid.
 *
 * The CSP is here rather than in `next.config.ts` for one reason: the nonce has
 * to be different per request, and a header declared in the config is a
 * constant. It is set on the **request** as well as the response, because that
 * is how Next finds the nonce and stamps it onto the script tags it emits — a
 * policy on the response alone produces a page whose own bootstrap is blocked.
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    s3Endpoint: process.env.S3_ENDPOINT,
    development: process.env.NODE_ENV !== 'production',
  })

  const headers = new Headers(request.headers)
  headers.set('content-security-policy', csp)
  headers.set('x-nonce', nonce)

  let response = NextResponse.next({ request: { headers } })
  response.headers.set('content-security-policy', csp)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          // Rebuilt from the mutated request so the refreshed cookie is visible
          // to the render that follows, not only to the browser. The policy has
          // to be reapplied: this is a new response object, and one without the
          // CSP would serve an unprotected page on exactly the requests where a
          // session was refreshed.
          response = NextResponse.next({ request: { headers } })
          response.headers.set('content-security-policy', csp)
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  await supabase.auth.getClaims()

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Refreshing a
     * session in order to serve a favicon is pure latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
}
