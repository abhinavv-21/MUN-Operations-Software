import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { scope, scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { runSerializable } from '../transaction.ts'
import { findPublicConference } from '../scope-resolution.ts'
import {
  generateReference,
  isHoneypotTripped,
  LIVE_REGISTRATION_STATUSES,
  honeypotDelay,
} from '../registrations.ts'

export const publicRegistrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.email('Enter a valid email address').trim().toLowerCase().max(200),
  phone: z.string().trim().max(40).nullable().default(null),
  schoolName: z.string().trim().max(160).nullable().default(null),
  grade: z.string().trim().max(60).nullable().default(null),

  // Read, stored, and never acted on. A form answer is a wish; an allocation is
  // a decision the secretariat makes.
  committeePreference: z.string().trim().max(120).nullable().default(null),
  committeePreference2: z.string().trim().max(120).nullable().default(null),

  munsAttended: z.number().int().min(0).max(200).nullable().default(null),
  awardsWon: z.number().int().min(0).max(200).nullable().default(null),

  paymentProofUrl: z.url().max(500).nullable().default(null),
  dietaryNotes: z.string().trim().max(500).nullable().default(null),
  accessibilityNotes: z.string().trim().max(500).nullable().default(null),
})

export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>

/**
 * The only body this endpoint returns — to a genuine submission, to a repeat
 * submission, and to a caught bot alike.
 *
 * There is deliberately no second shape. A `200 { status: 'duplicate' }` would
 * answer "has this person applied to this conference?" for anyone holding a
 * school email list. The type offers nowhere to put one.
 */
export interface RegistrationAccepted {
  status: 'received'
  reference: string
}

export interface SubmissionMeta {
  submittedIp: string | null
  userAgent: string | null
}

/** 32^6 references. Five attempts is already well past paranoia. */
const MAX_REFERENCE_ATTEMPTS = 5

function isReferenceCollision(error: unknown): boolean {
  if ((error as { code?: string }).code !== 'P2002') return false
  const target = (error as { meta?: { target?: unknown } }).meta?.target
  const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : []
  return fields.some((field) => typeof field === 'string' && field.includes('reference'))
}

/**
 * Answers a filled honeypot exactly as a real submission is answered,
 * including a well-formed reference that matches nothing in the database.
 *
 * A bot that gets an error learns to fix its submission. One that gets a
 * plausible reference learns nothing.
 *
 * Called before validation, so a script never sees a field-level 422 either.
 * The only two responses it can distinguish are "accepted" and "rate limited",
 * and neither says why.
 */
export async function honeypotResponse(conferenceSlug: string): Promise<RegistrationAccepted> {
  // The gate answers without touching the database, which makes it measurably
  // faster than a genuine submission — a few milliseconds, consistently, which
  // is all a script needs to tell the two apart. Sleep for roughly what the
  // real path costs, jittered so the delay is not itself a signature.
  await new Promise((resolve) => setTimeout(resolve, honeypotDelay()))
  return { status: 'received', reference: generateReference(conferenceSlug) }
}

export function honeypotTripped(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  return isHoneypotTripped((body as Record<string, unknown>).hp_website)
}

export interface PublicConference {
  id: string
  slug: string
  name: string
  organizationSlug: string
  acceptingSubmissions: boolean
  closedReason: 'closed' | 'deadline' | null
}

/** Resolves the conference behind a public URL, or 404. */
export async function loadPublicConference(organizationSlug: string, conferenceSlug: string) {
  const conference = await findPublicConference(organizationSlug, conferenceSlug)
  if (!conference) throw ApiError.notFound('Not found')
  return conference
}

export function registrationWindow(conference: {
  status: string
  registrationDeadline: Date | null
}): { open: boolean; reason: 'closed' | 'deadline' | null } {
  if (conference.status !== 'OPEN') return { open: false, reason: 'closed' }
  if (conference.registrationDeadline && conference.registrationDeadline < new Date()) {
    return { open: false, reason: 'deadline' }
  }
  return { open: true, reason: null }
}

/**
 * Creates a registration, or finds the live one that already exists.
 *
 * Both outcomes return the same shape to the caller. The distinction exists
 * only so the caller can decide whether to write an audit row.
 *
 * Wrapped in a serializable transaction so a double-submitted form cannot slip
 * two PENDING rows past the check.
 */
export async function submitRegistration(
  conference: { id: string; slug: string; organizationId: string },
  input: PublicRegistrationInput,
  meta: SubmissionMeta,
): Promise<{ created: boolean; reference: string }> {
  const db = scope({ organizationId: conference.organizationId, conferenceId: conference.id })

  for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      return await runSerializable(db, async (tx) => {
        const existing = await tx.registration.findFirst({
          where: { email: input.email, status: { in: [...LIVE_REGISTRATION_STATUSES] } },
          orderBy: { createdAt: 'desc' },
          select: { reference: true },
        })
        // One *live* application per address. A rejected applicant may
        // legitimately reapply, which is why this is a lookup and not a
        // database constraint.
        if (existing) return { created: false, reference: existing.reference }

        const created = await tx.registration.create({
          data: scopedCreate<Prisma.RegistrationUncheckedCreateInput>({
            reference: generateReference(conference.slug),
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            schoolName: input.schoolName,
            grade: input.grade,
            committeePreference: input.committeePreference,
            committeePreference2: input.committeePreference2,
            munsAttended: input.munsAttended,
            awardsWon: input.awardsWon,
            paymentProofUrl: input.paymentProofUrl,
            dietaryNotes: input.dietaryNotes,
            accessibilityNotes: input.accessibilityNotes,
            submittedIp: meta.submittedIp,
            userAgent: meta.userAgent,
          }),
          select: { reference: true },
        })

        return { created: true, reference: created.reference }
      })
    } catch (error) {
      if (!isReferenceCollision(error) || attempt === MAX_REFERENCE_ATTEMPTS) throw error
    }
  }

  throw ApiError.internal('Could not allocate a reference')
}
