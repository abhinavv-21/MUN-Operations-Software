import { scope } from '../db.ts'
import { ApiError } from '../errors.ts'
import type { AccessTokenClaims } from './verify.ts'

export interface AppUser {
  id: string
  authUserId: string
  email: string
  fullName: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  address: string | null
  avatarUrl: string | null
  profileCompletedAt: Date | null
}

/**
 * Turns a verified token into a row in our `User` table, creating it on first
 * sign-in.
 *
 * Just-in-time provisioning in application code, deliberately, rather than
 * either of the two alternatives:
 *
 * - A database trigger on `auth.users` is invisible in the repository, is not
 *   covered by any test, and disappears the first time someone runs
 *   `migrate reset`.
 * - A webhook introduces a window where the account exists in Supabase Auth and
 *   not in the application, which is a state you end up debugging at 2am from a
 *   support message rather than from a stack trace.
 *
 * `User` is a global model, so the empty scope is correct here: identity spans
 * organisations, and this runs before any tenant is known — resolving it is
 * what makes a tenant knowable.
 */
export async function getOrCreateUser(claims: AccessTokenClaims): Promise<AppUser> {
  const db = scope({})

  const existing = await db.user.findUnique({ where: { authUserId: claims.sub } })

  if (existing) {
    // Names and avatars change at the provider. Written back only when they
    // actually differ, so the common request stays a single read.
    // The provider is the source of truth for what it knows, and our row is the
    // source of truth for what only we collect. Neither overwrites the other
    // with a blank.
    const next = {
      email: claims.email,
      fullName: claims.fullName ?? existing.fullName,
      firstName: claims.firstName ?? existing.firstName,
      lastName: claims.lastName ?? existing.lastName,
      phone: claims.phone ?? existing.phone,
      address: claims.address ?? existing.address,
      avatarUrl: claims.avatarUrl ?? existing.avatarUrl,
    }

    const changed = (Object.keys(next) as (keyof typeof next)[]).some(
      (key) => next[key] !== existing[key],
    )

    return changed ? db.user.update({ where: { id: existing.id }, data: next }) : existing
  }

  try {
    return await db.user.create({
      data: {
        authUserId: claims.sub,
        email: claims.email,
        fullName: claims.fullName ?? null,
        firstName: claims.firstName ?? null,
        lastName: claims.lastName ?? null,
        phone: claims.phone ?? null,
        address: claims.address ?? null,
        avatarUrl: claims.avatarUrl ?? null,
      },
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'P2002') throw error

    // Two tabs finishing the OAuth dance at the same moment both reach this
    // point with no row and both try to create one. The loser re-reads.
    const raced = await db.user.findUnique({ where: { authUserId: claims.sub } })
    if (raced) return raced

    // Not a race: the email belongs to a different Supabase subject. Supabase
    // links identities that share a verified email into one account, so this
    // means something we did not expect rather than a merge to perform
    // silently. Guessing here is how one person ends up inside another's
    // organisation.
    throw ApiError.conflict(
      'That email address is already attached to a different account. Contact support.',
    )
  }
}
