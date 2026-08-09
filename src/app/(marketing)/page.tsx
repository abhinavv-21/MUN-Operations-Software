import { Fragment } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { CountryMatrixBand } from '@/components/marketing/CountryMatrix.tsx'
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/product.ts'

export const metadata: Metadata = {
  // The root layout's template appends the product name; the landing page is
  // the one place that would then say it twice.
  title: { absolute: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}` },
  description: PRODUCT_DESCRIPTION,
}

/**
 * The landing page.
 *
 * ## The thesis
 *
 * Every other tool in this space is built for the **executive board** — a
 * speakers list, a motion queue, a caucus timer. That is one room for three
 * days. The organising committee, who are the people actually drowning, go
 * looking for software, find committee tools, conclude none of it fits, and go
 * back to the spreadsheet.
 *
 * So the page leads with the distinction rather than with features. "Everything
 * outside the committee room" is the product in five words, and it is a
 * sentence no competitor's landing page can say.
 *
 * ## The structure
 *
 * Five bands, and no two of them are the same ground or the same height:
 *
 *     the claim          .ground-app     tall, two columns, no picture
 *     the matrix         .ground-paper   short, full bleed, runs off the edge
 *     the distinction    .ground-ink     tallest — this is the argument
 *     the day            .ground-blush   three moments on one rail
 *     the offer          .ground-brand   the single conversion point
 *     the footer         .ground-ink     a hard stop
 *
 * All five grounds, each used once, in an order that alternates weight rather
 * than repeating a section rhythm five times. Every pair on every ground goes
 * through `contrastPairs` in `build.ts`, so this survives an organiser
 * re-theming the product to slate.
 *
 * ## Restraint
 *
 * One animated moment — the matrix filling itself in — and nothing else moves.
 * Scroll-triggered reveals were considered and cut: they cost JavaScript, they
 * are the default gesture of every generated landing page, and one orchestrated
 * moment lands harder than five scattered ones.
 *
 * What was removed, in the last pass: a two-column "two promises" band that sat
 * between the day and the offer. Both promises are still made — the offline one
 * inside the 11:15 moment, which is literally the moment it describes, and the
 * Google Form one in the distinction, where the objection it answers is being
 * raised. Neither needed its own essay, and side-by-side essays are the shape
 * that makes a page feel assembled rather than written.
 *
 * No session, no database, no client component — but **not statically
 * prerendered**, because the root layout reads the CSP nonce out of the request
 * headers and a nonce cannot exist before a request does. The trade is argued in
 * `src/lib/csp.ts`.
 */

/**
 * Three moments, and the reason they are moments rather than features.
 *
 * An organising committee does not buy "attendance management". They buy the
 * eleven minutes at 08:40 when three hundred people are in a queue. Each one is
 * a time on a clock, because that is how the day is actually remembered — and
 * because a clock encodes something true that a generic 01 / 02 / 03 does not.
 *
 * `surface` is the part of the product that turns out to be the answer. It is
 * named after the moment rather than the other way round, which is the whole
 * ordering of this page.
 */
const MOMENTS = [
  {
    time: '08:40',
    place: 'The registration desk',
    body: 'Three hundred delegates in a queue and one volunteer with a printed list. Check them in by name or by committee on a phone, and watch the count of who has not arrived yet.',
    surface: 'Attendance',
  },
  {
    time: '11:15',
    place: 'A basement committee room',
    body: 'The projector is dead and there is no signal down here. The request is raised anyway, saved on the device, and delivered the moment there is a bar of signal — safe to send twice, so a bad network costs you nothing.',
    surface: 'Logistics · works offline',
  },
  {
    time: '17:50',
    place: 'The dais',
    body: 'Awards read committee by committee, best delegate first, off a list that cannot contain somebody who was never in that committee.',
    surface: 'Awards',
  },
]

/**
 * What "outside the committee room" actually means, as a list of nouns.
 *
 * Deliberately not a three-column grid of icons with a heading and two lines
 * each. It is one wrapped line of the organising committee's own vocabulary,
 * and its density is the point: this is how much of the job is not the
 * speakers list.
 */
const SURFACE = [
  'Registrations',
  'Review',
  'Delegates',
  'Committees',
  'Country matrix',
  'Allocations',
  'Registration desk',
  'Attendance',
  'Logistics',
  'Awards',
  'Exports',
  'Audit log',
  'Members',
  'Past editions',
]

/** The multi-edition model, shown rather than claimed, at the conversion point. */
const EDITIONS = [
  { year: '2023', status: 'Archived', count: '412 delegates' },
  { year: '2024', status: 'Archived', count: '486 delegates' },
  { year: '2025', status: 'Live', count: '38 registered' },
]

export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* The claim                                                         */}
      {/* ---------------------------------------------------------------- */}

      <section>
        <div className="mx-auto grid w-full max-w-page gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[minmax(0,1.32fr)_minmax(0,0.88fr)] lg:gap-16 lg:py-28">
          <div>
            {/* No bullet, no rule, no ornament before it. Anything set to the
                left of this line pushes it off the headline's left edge, and
                the two sharing one margin is what makes the corner read as
                deliberate. */}
            <p className="font-mono text-label uppercase text-on-ground-muted">{PRODUCT_TAGLINE}</p>

            <h1 className="mt-6 max-w-hero font-heading text-hero text-on-ground">
              Everything outside the committee room.
            </h1>
          </div>

          {/* Bottom-aligned against the headline's last line, so the two
              columns share a baseline instead of both starting at the top and
              ending wherever they happen to end. */}
          <div className="lg:self-end lg:pb-2">
            <p className="max-w-prose text-lead text-on-ground-muted">
              Your chairs have a speakers list. You have three hundred registrations, a country
              matrix nobody else is allowed to edit, a registration desk at 08:40 and a projector
              that just died in the basement.{' '}
              <span className="text-on-ground">{PRODUCT_NAME} runs that half.</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
              <Button asChild>
                <Link href="/sign-in">
                  Start a conference
                  <ArrowRight size={16} aria-hidden />
                </Link>
              </Button>
              {/* A link, not a second button. Two buttons of equal weight side
                  by side is the default shape of every generated hero, and it
                  makes the reader choose before they have read anything. */}
              <Link
                href="/how-it-works"
                className="rounded-control text-body font-medium text-on-ground underline decoration-hairline underline-offset-4 duration-micro ease-standard hover:decoration-current"
              >
                See how it works
              </Link>
            </div>

            <p className="mt-6 font-mono text-label uppercase text-on-ground-muted">
              Free for two conferences · No card · Nothing to cancel
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The matrix — the signature, full bleed                            */}
      {/* ---------------------------------------------------------------- */}

      <CountryMatrixBand />

      {/* ---------------------------------------------------------------- */}
      {/* The distinction — the one dark section, and the tallest           */}
      {/* ---------------------------------------------------------------- */}

      <section className="ground-ink">
        <div className="mx-auto w-full max-w-page px-5 py-20 md:px-8 md:py-32">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-20">
            <div className="flex flex-col justify-between gap-12">
              <div>
                <p className="font-mono text-label uppercase text-on-ground-muted">The difference</p>
                <h2 className="mt-5 font-heading text-title text-on-ground">
                  Built for the organising committee, not the executive board.
                </h2>
              </div>

              {/* The argument as two lines of arithmetic. Not a comparison
                  table — a table invites a row for every feature and ends up
                  arguing about caucus timers, which is the fight this product
                  is trying not to have. Two counts, and the last one is the
                  reason anybody is reading this page. */}
              <dl className="flex flex-col gap-6">
                <div className="border-t border-hairline pt-4">
                  <dt className="font-mono text-label uppercase text-on-ground-muted">
                    The executive board runs
                  </dt>
                  <dd className="mt-2 font-mono text-body text-on-ground">
                    1 committee · 3 days · 1 room
                  </dd>
                </div>
                <div className="border-t border-hairline pt-4">
                  <dt className="font-mono text-label uppercase text-on-ground-muted">You run</dt>
                  <dd className="mt-2 font-mono text-body text-on-ground">
                    14 committees · 300 delegates · 1 spreadsheet
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-6 text-lead text-on-ground-muted">
              <p>
                Search for Model UN software and you find tools for chairs. A speakers list, a
                motion queue, a caucus timer — one committee, three days, and none of it any use to
                the people who have to fill that committee in the first place.
              </p>
              <p className="text-on-ground">
                {PRODUCT_NAME} is the other half of the conference, and it starts where your
                spreadsheet does: point the Google Form your society already uses at it, or paste a
                CSV. There is no form builder to learn, and the columns are matched by name —
                including the ones somebody renamed three editions ago.
              </p>
              <p>
                Your executive board can keep whatever they already use. Nothing here tries to run a
                committee session, because that is not the part that goes wrong.
              </p>
            </div>
          </div>

          <div className="mt-16 border-t border-hairline pt-8 md:mt-20">
            <p className="font-mono text-label uppercase text-on-ground-muted">
              What outside the committee room means
            </p>
            <p className="mt-5 font-heading text-h1 text-on-ground md:text-display">
              {/*
                Each noun and the separator after it are one unbreakable unit,
                with the only break opportunity in the space between units.
                Without the first half, "Country matrix" splits over two lines
                and the reader is briefly told the product does countries and,
                separately, matrices. Without the second, a line begins with a
                floating interpunct.
              */}
              {SURFACE.map((item, index) => (
                <Fragment key={item}>
                  <span className="whitespace-nowrap">
                    {item}
                    {index < SURFACE.length - 1 ? (
                      <span className="text-on-ground-muted" aria-hidden>
                        {' ·'}
                      </span>
                    ) : null}
                  </span>{' '}
                </Fragment>
              ))}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The day                                                           */}
      {/* ---------------------------------------------------------------- */}

      <section className="ground-blush border-b border-hairline">
        <div className="mx-auto w-full max-w-page px-5 py-20 md:px-8 md:py-28">
          <div>
            <p className="font-mono text-label uppercase text-on-ground-muted">Conference day</p>
            {/* `em`, so the measure scales with the heading rather than with the
                15px body text a `ch`-based container would be counting. */}
            <h2 className="mt-5 max-w-[14em] font-heading text-title text-on-ground">
              The three hours that decide whether a conference ran well
            </h2>
            <p className="mt-5 max-w-prose text-lead text-on-ground-muted">
              Not the six months of planning. Three specific hours, and everybody who has run one
              knows exactly which.
            </p>
          </div>

          {/* One hairline across the whole section is the day; each moment is a
              tick on it. Three separate bordered cards would say three things
              happened, which is not the same claim.

              Stacked on a phone there is no "across", so the rule moves onto
              each item instead of leaving two accent ticks floating in space
              under a rule that ended three moments ago. */}
          <ol className="mt-16 grid gap-x-10 gap-y-14 md:mt-20 md:grid-cols-3 md:border-t md:border-hairline">
            {MOMENTS.map((moment) => (
              // A flex column with the surface pushed to the bottom, so the
              // three mono lines sit on one baseline instead of following
              // three paragraphs of different lengths.
              <li
                key={moment.time}
                className="relative flex flex-col border-t border-hairline pt-8 md:border-t-0"
              >
                <span className="day-tick" aria-hidden />
                <p className="font-mono text-title tabular-nums text-accent-on-ground">
                  {moment.time}
                </p>
                <h3 className="mt-4 font-heading text-h2 text-on-ground">{moment.place}</h3>
                <p className="mt-3 text-body text-on-ground-muted">{moment.body}</p>
                <p className="mt-auto pt-6 font-mono text-label uppercase text-on-ground-muted">
                  {moment.surface}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The offer — the one saturated ground on the page                  */}
      {/* ---------------------------------------------------------------- */}

      <section className="ground-brand">
        <div className="mx-auto grid w-full max-w-page gap-12 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-20">
          <div>
            <p className="font-mono text-label uppercase text-on-ground-muted">One account</p>
            <h2 className="mt-5 font-heading text-title text-on-ground">
              A society is not one conference
            </h2>
            <p className="mt-5 max-w-prose text-lead text-on-ground-muted">
              Last year stays exactly as it finished while next year is being built, and the same
              student registering for both is one person in two places rather than a duplicate to
              clean up in March.
            </p>

            <p className="mt-5 max-w-prose text-body text-on-ground-muted">
              Two conferences free. More on request — email us and the limit goes up, because there
              is no upgrade page to hunt for.
            </p>

            <div className="mt-9">
              <Button variant="secondary" asChild>
                <Link href="/sign-in">
                  Start a conference
                  <ArrowRight size={16} aria-hidden />
                </Link>
              </Button>
            </div>
          </div>

          {/* The right-hand side of a conversion band is usually empty, or a
              stock illustration. This is the claim itself, drawn: three
              editions on one account, two of them finished and still readable. */}
          <div className="lg:pt-9">
            <p className="font-mono text-label uppercase text-on-ground-muted">Your editions</p>
            <ul className="mt-4 border-t border-hairline">
              {EDITIONS.map((edition) => (
                <li
                  key={edition.year}
                  className="flex items-baseline justify-between gap-4 border-b border-hairline py-4 font-mono"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="text-h2 tabular-nums text-on-ground">{edition.year}</span>
                    <span className="text-label uppercase text-on-ground-muted">
                      {edition.status}
                    </span>
                  </span>
                  <span className="text-body-sm tabular-nums text-on-ground-muted">
                    {edition.count}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 font-mono text-label uppercase text-on-ground-muted">
              Nothing to migrate · Nothing to archive by hand
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
