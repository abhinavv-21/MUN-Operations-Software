import { createSupabaseServerClient } from '@/lib/supabase/server.ts'
import { ApiError } from '../errors.ts'
import { verifyAccessToken, type AccessTokenClaims } from './verify.ts'

/**
 * Reads the access token out of the session cookie and verifies it ourselves.
 *
 * `getSession()` is a cookie read with no network call. Its documented caveat —
 * that the `user` object it returns must not be trusted — is exactly why only
 * `access_token` is taken from it and handed to `verifyAccessToken`, which
 * checks the signature against the project's JWKS.
 */
async function readToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * The caller's claims, or null when nobody is signed in.
 *
 * A token that is present but invalid throws rather than resolving to null. An
 * expired session and an anonymous visitor are different situations: one needs
 * a sign-in prompt, the other is just someone reading a public page.
 */
export async function optionalClaims(): Promise<AccessTokenClaims | null> {
  const token = await readToken()
  if (!token) return null
  return verifyAccessToken(token)
}

export async function requireClaims(): Promise<AccessTokenClaims> {
  const claims = await optionalClaims()
  if (!claims) throw ApiError.unauthorized('Sign in to continue')
  return claims
}
