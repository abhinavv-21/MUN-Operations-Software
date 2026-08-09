import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server.ts'

/**
 * Signs out everywhere, not just in this browser.
 *
 * `scope: 'global'` revokes every refresh token for the account. This is the
 * guarantee the reference product built an entire `Session` table to provide,
 * after a token copied from a shared school machine kept minting access tokens
 * for a week with no way to stop it. Supabase does it in one call.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut({ scope: 'global' })

  return NextResponse.redirect(new URL('/', new URL(request.url).origin), { status: 303 })
}
