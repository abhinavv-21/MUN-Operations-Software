import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { CalendarDays, MapPin } from 'lucide-react'
import { ThemeStyle } from '@/components/ThemeStyle.tsx'
import { buildThemeVars, serializeVars } from '@/lib/theme/build.ts'
import { parseTheme } from '@/lib/theme/schema.ts'
import { isApiError } from '@/server/errors.ts'
import {
  loadPublicConference,
  registrationWindow,
} from '@/server/services/public-registration.ts'
import { RegistrationForm } from './RegistrationForm.tsx'

type Params = { orgSlug: string; conferenceSlug: string }

async function load(params: Promise<Params>) {
  const { orgSlug, conferenceSlug } = await params
  try {
    return { orgSlug, conferenceSlug, conference: await loadPublicConference(orgSlug, conferenceSlug) }
  } catch (error) {
    if (isApiError(error) && error.code === 404) notFound()
    throw error
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { conference } = await load(params)
  return {
    title: `Register · ${conference.name}`,
    description: `Registration for ${conference.name}${conference.venue ? `, ${conference.venue}` : ''}.`,
  }
}

function formatDates(startsOn: Date | null, endsOn: Date | null): string | null {
  if (!startsOn) return null
  const format = (date: Date) =>
    date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  if (!endsOn || startsOn.getTime() === endsOn.getTime()) return format(startsOn)
  return `${format(startsOn)} – ${format(endsOn)}`
}

function formatFee(minorUnits: number | null, currency: string | null): string | null {
  if (minorUnits === null) return null
  const amount = minorUnits / 100
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency ?? 'INR',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount}`
  }
}

/**
 * The public registration page.
 *
 * Server-rendered and themed from the conference's own row, falling back to the
 * organisation's default — so an applicant sees the organiser's branding in the
 * first byte, with no flash and no client script involved.
 */
export default async function PublicRegistrationPage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceSlug, conference } = await load(params)

  // The third `<style>` in the product, and the one that was missed when the
  // CSP nonce was threaded through the other two. Without it the browser
  // refuses this block and the applicant sees the product's default palette
  // instead of the organiser's — a page that looks fine and is wrong.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  // The conference's own theme wins; the organisation's is the inherited
  // default; the product's is the floor.
  const theme = parseTheme(conference.theme ?? conference.organization.defaultTheme)
  const themeCss = serializeVars(buildThemeVars(theme))

  const window = registrationWindow(conference)
  const dates = formatDates(conference.startsOn, conference.endsOn)
  const fee = formatFee(conference.feeMinorUnits, conference.feeCurrency)

  return (
    <>
      <ThemeStyle css={themeCss} nonce={nonce} />
      <main className="ground-app min-h-dvh px-4 py-10 md:px-8 md:py-16">
        <div className="mx-auto w-full max-w-2xl">
          <header>
            <p className="text-label uppercase text-ink-secondary">
              {conference.organization.name}
            </p>
            <h1 className="mt-2 font-heading text-display text-ink">{conference.name}</h1>
            <span className="page-rule mt-4" aria-hidden />

            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
              {dates ? (
                <div className="flex items-center gap-2">
                  <CalendarDays size={16} className="text-ink-tertiary" aria-hidden />
                  <dt className="sr-only">Dates</dt>
                  <dd className="text-body text-ink-secondary">{dates}</dd>
                </div>
              ) : null}
              {conference.venue ? (
                <div className="flex items-center gap-2">
                  <MapPin size={16} className="text-ink-tertiary" aria-hidden />
                  <dt className="sr-only">Venue</dt>
                  <dd className="text-body text-ink-secondary">{conference.venue}</dd>
                </div>
              ) : null}
              {fee ? (
                <div className="flex items-center gap-2">
                  <dt className="text-body text-ink-secondary">Delegate fee</dt>
                  <dd className="text-body text-ink">{fee}</dd>
                </div>
              ) : null}
            </dl>
          </header>

          <section className="mt-10 rounded-card border border-edge bg-surface p-6 md:p-8">
            {window.open ? (
              <RegistrationForm
                orgSlug={orgSlug}
                conferenceSlug={conferenceSlug}
                deadline={
                  conference.registrationDeadline
                    ? conference.registrationDeadline.toISOString()
                    : null
                }
              />
            ) : (
              <div>
                <h2 className="font-heading text-h2 text-ink">
                  {window.reason === 'deadline'
                    ? 'Registration has closed'
                    : 'Registration is not open'}
                </h2>
                <p className="mt-2 text-body text-ink-secondary">
                  {window.reason === 'deadline'
                    ? 'The deadline for this conference has passed. Contact the organisers if you believe this is a mistake.'
                    : 'This conference is not accepting registrations at the moment. Check back, or contact the organisers.'}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  )
}
