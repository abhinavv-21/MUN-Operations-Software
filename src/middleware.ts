import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase session cookie. That is the entire job.
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
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          // Rebuilt from the mutated request so the refreshed cookie is visible
          // to the render that follows, not only to the browser.
          response = NextResponse.next({ request })
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
