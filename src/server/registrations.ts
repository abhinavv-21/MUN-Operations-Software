import { randomInt } from 'node:crypto'
import type { RegistrationStatus } from '@/generated/prisma/enums.ts'

/**
 * Pure logic behind public registrations.
 *
 * Deliberately free of Prisma and of any request object, so both can be
 * exercised without a database. Ported from the reference product with its
 * reasoning intact; the only change is that the reference prefix is now
 * per-conference rather than a hardcoded `LMX-`.
 */

/**
 * Crockford-style alphabet with the characters people mistake for each other
 * removed: I/1 and O/0. A reference gets read down the phone and copied off a
 * screenshot, so "was that an O or a zero" is a real support cost.
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * Six characters over a 32-symbol alphabet is about 1.07 billion codes. Long
 * enough that a code cannot be guessed into an existing application, short
 * enough to dictate in one breath.
 */
export const REFERENCE_LENGTH = 6

/**
 * A per-conference prefix, derived from the slug.
 *
 * The reference product hardcodes `LMX-` because it serves one conference.
 * Here a delegate may hold references from two editions at once, and
 * `MUNXI-4K7P2Q` tells them which is which without a lookup.
 */
export function referencePrefix(conferenceSlug: string): string {
  const letters = conferenceSlug
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
  return `${letters || 'MUN'}-`
}

/**
 * Generates a submission reference.
 *
 * `randomInt` rather than `Math.random`: the reference is the only handle an
 * applicant holds on their own row, so a sequence someone could replay to
 * enumerate other people's applications is not acceptable.
 */
export function generateReference(conferenceSlug: string): string {
  let code = ''
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]
  }
  return `${referencePrefix(conferenceSlug)}${code}`
}

export function referencePattern(conferenceSlug: string): RegExp {
  return new RegExp(`^${referencePrefix(conferenceSlug)}[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`)
}

/** A registration in one of these states is awaiting review or already holds a place. */
export const LIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = ['PENDING', 'APPROVED']

export type ReviewAction = 'approve' | 'reject'

export interface TransitionCheck {
  allowed: boolean
  /** Present only when refused, and safe to show an organiser. */
  reason?: string
}

/**
 * Whether an organiser may apply `action` to a registration in `status`.
 *
 * Only PENDING is reviewable. A decision already taken is not re-taken
 * silently: approving twice would try to mint a second delegate, and rejecting
 * an approved application would leave a real Delegate row with no application
 * behind it. Both are conflicts the caller has to resolve explicitly.
 */
export function checkReviewTransition(
  status: RegistrationStatus,
  action: ReviewAction,
): TransitionCheck {
  if (status === 'PENDING') return { allowed: true }

  if (status === 'APPROVED') {
    return {
      allowed: false,
      reason:
        action === 'approve'
          ? 'This registration has already been approved and its delegate exists.'
          : 'This registration was already approved. Delete the delegate it created before rejecting it.',
    }
  }

  return {
    allowed: false,
    reason:
      action === 'approve'
        ? 'This registration was rejected. Ask the applicant to submit a new one rather than reversing the decision.'
        : 'This registration has already been rejected.',
  }
}

/**
 * True when the honeypot field was filled in.
 *
 * Only a script that fills every input touches it — the field is hidden from
 * humans and from screen readers on the page.
 */
export function isHoneypotTripped(value: unknown): boolean {
  // Absent or an empty string is a human. Anything else — including a number
  // or an object, which would otherwise fall through to a 422 that names the
  // field — is the trap being touched.
  if (value === undefined || value === null) return false
  if (typeof value !== 'string') return true
  return value.trim().length > 0
}

/** Roughly the cost of the real path, so the trap is not measurably faster. */
export const HONEYPOT_DELAY_MS = 8
export const HONEYPOT_JITTER_MS = 6

export function honeypotDelay(): number {
  return HONEYPOT_DELAY_MS + randomInt(0, HONEYPOT_JITTER_MS)
}
