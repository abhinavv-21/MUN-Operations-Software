import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server.ts'
import { safeNextPath } from '@/lib/safe-redirect.ts'

/**
 * Where Google and the email magic link land.
 *
 * Exchanges the one-time code for a session and sets the cookie. This is a
 * Route Handler rather than a page because it must be able to write cookies,
 * which a Server Component cannot.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  const next = safeNextPath(url.searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_code', url.origin))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/sign-in?error=exchange_failed', url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
