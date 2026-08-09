/**
 * Access token verification.
 *
 * Verified locally against the project's JWKS rather than by asking Supabase
 * who the caller is. `supabase.auth.getUser()` is a network round trip, and
 * putting one in front of every API call and every server-rendered page adds
 * latency to the whole product in exchange for something the signature already
 * proves.
 *
 * The project uses asymmetric ES256 signing keys, confirmed against its JWKS
 * endpoint, so there is deliberately no HS256 branch here. If the project were
 * ever moved back to legacy symmetric keys this would fail closed — loudly, on
 * the first request — rather than accepting a token it could not check.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { jwksUrl, tokenIssuer } from '@/lib/supabase/config.ts'
import { ApiError } from '../errors.ts'

/**
 * Cached at module scope, which is the whole point: the key set is fetched once
 * per server instance and reused, with `jose` handling rotation and re-fetch on
 * an unknown `kid`.
 */
let keySet: ReturnType<typeof createRemoteJWKSet> | undefined

function remoteKeySet() {
  // Built lazily rather than at import time so that importing this module does
  // not require configuration — tests import it without a Supabase project.
  keySet ??= createRemoteJWKSet(jwksUrl())
  return keySet
}

export interface AccessTokenClaims {
  /** The Supabase subject. Stored on `User.authUserId`, never used as our id. */
  sub: string
  email: string
  /** 'google', 'email', … */
  provider?: string
  fullName?: string
  firstName?: string
  lastName?: string
  phone?: string
  address?: string
  /** Only present on the first sign-in after sign-up. */
  organizationName?: string
  avatarUrl?: string
}

interface SupabaseJwtPayload extends JWTPayload {
  email?: string
  app_metadata?: { provider?: string }
  user_metadata?: {
    full_name?: string
    name?: string
    /** Google returns these; our own sign-up form writes them. */
    given_name?: string
    family_name?: string
    first_name?: string
    last_name?: string
    phone?: string
    address?: string
    organization_name?: string
    avatar_url?: string
    picture?: string
  }
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let payload: SupabaseJwtPayload
  try {
    // jwtVerify checks the signature, `exp` and `nbf`. Issuer and audience are
    // checked because a valid signature from the right project is not the same
    // as a token minted for this audience.
    const result = await jwtVerify<SupabaseJwtPayload>(token, remoteKeySet(), {
      issuer: tokenIssuer(),
      audience: 'authenticated',
    })
    payload = result.payload
  } catch {
    // Never echo the reason. "Expired" versus "bad signature" is a distinction
    // the caller does not need and an attacker does.
    throw ApiError.unauthorized('Your session is not valid. Sign in again.')
  }

  if (!payload.sub) throw ApiError.unauthorized('Your session is not valid. Sign in again.')
  if (!payload.email) {
    // Every provider we enable returns one, and the product keys profile and
    // invitations on it. A token without one is not something to guess around.
    throw ApiError.unauthorized('That account has no email address attached.')
  }

  const metadata = payload.user_metadata ?? {}

  const firstName = metadata.first_name ?? metadata.given_name
  const lastName = metadata.last_name ?? metadata.family_name
  const fullName =
    metadata.full_name ??
    metadata.name ??
    ([firstName, lastName].filter(Boolean).join(' ') || undefined)

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    provider: payload.app_metadata?.provider,
    fullName,
    firstName,
    lastName,
    phone: metadata.phone,
    address: metadata.address,
    organizationName: metadata.organization_name,
    avatarUrl: metadata.avatar_url ?? metadata.picture,
  }
}
