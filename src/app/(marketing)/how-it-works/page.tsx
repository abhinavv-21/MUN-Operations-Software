import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'From a Google Form to closing ceremony: registration, review, allocation, and the conference day itself.',
}

/**
 * How it works.
 *
 * Four steps in the order they happen, because that is the order an organiser
 * has the questions in. Reads nothing, like the landing page.
 *
 * ## The refusals are the layout
 *
 * Each step says what the product will not do as well as what it does, and the
 * previous version buried that in a small indented line under the body — which
 * is precisely backwards. The refusals are the design decisions, they are the
 * reason an organising committee can trust the rest of the page, and an
 * organiser who discovers them on the day has been misled by whatever brought
 * them here. So "will not" is its own column, the same width and the same
 * weight as "does", for the whole length of the page.
 *
 * The numbers survive here where they would be dishonest on the landing page:
 * this genuinely is a sequence, step three cannot happen before step two, and
 * that ordering is the thing an organiser is trying to work out.
 */

interface Step {
  id: string
  number: string
  title: string
  body: string
  refusal: string
}

const STEPS: Step[] = [
  {
    id: 'applications-arrive',
    number: '01',
    title: 'Applications arrive',
    body: 'Publish a registration page for the conference and share the link, or point the Google Form your society already uses at it. Column names are matched to fields, so “Student Name” and “Full name” land in the same place.',
    refusal:
      'It never creates an account for an applicant. Registering does not put anybody inside your organisation.',
  },
  {
    id: 'you-review-them',
    number: '02',
    title: 'You review them',
    body: 'Applications sit in a queue with the school, the previous MUNs and the payment screenshot. Approving one creates a delegate. Rejecting one takes a reason, because “why was I turned down” gets asked in March.',
    refusal:
      'Approving never allocates. The committee somebody asked for is stored and acted on by nobody.',
  },
  {
    id: 'you-allocate',
    number: '03',
    title: 'You allocate',
    body: 'Import the country matrix as a column per committee or a row per seat. Allocate delegates against it with seat capacity enforced as you go — two people allocating the last seat in UNSC at the same moment get one seat and one clear message.',
    refusal:
      'A committee with no matrix is unconstrained rather than broken, so one committee can be finalised while five are still being argued about.',
  },
  {
    id: 'the-conference-runs',
    number: '04',
    title: 'The conference runs',
    body: 'Check delegates in each morning, raise logistics requests from wherever the problem is, and record awards committee by committee. Export any of it to CSV, Excel or PDF. Every change is in an audit log with who made it.',
    refusal:
      'Check-ins and logistics requests survive a dead network. Everything else refuses to save rather than pretending.',
  },
]

const LIMITS = [
  {
    title: 'It sends no email of its own',
    body: 'Invitation links are yours to forward, from the mail client you already use and the address delegates already recognise.',
  },
  {
    title: 'It takes no payments',
    body: 'Upload a screenshot and mark it reviewed. Being a payment processor for other people’s money is a different product with a different regulator.',
  },
  {
    title: 'There is no form builder',
    body: 'Your Google Form is your custom form. Nothing to rebuild, and nothing to migrate the week before applications open.',
  },
  {
    title: 'There is no dark mode, and no app',
    body: 'Not yet. The web app is built for a phone held in one hand at a registration desk, which is the case that actually had to work.',
  },
]

export default function HowItWorksPage() {
  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Title, with the sequence itself as the right-hand column          */}
      {/* ---------------------------------------------------------------- */}

      <section>
        <div className="mx-auto grid w-full max-w-page gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-20">
          <div>
            <p className="font-mono text-label uppercase text-on-ground-muted">How it works</p>
            <h1 className="mt-6 max-w-hero font-heading text-title text-on-ground">
              From a form to closing ceremony
            </h1>
            <p className="mt-6 max-w-prose text-lead text-on-ground-muted">
              Four steps, in the order they happen. Each one also says what the product deliberately
              will not do, because those are the decisions you will notice.
            </p>
          </div>

          {/* Real in-page anchors, not a decorative index. On a page this long
              the reader almost always arrives with one of the four questions. */}
          <nav aria-label="Steps" className="lg:self-end">
            <ol className="border-t border-hairline">
              {STEPS.map((step) => (
                <li key={step.id} className="border-b border-hairline">
                  <Link
                    href={`#${step.id}`}
                    className="flex items-baseline gap-5 rounded-control py-3.5 duration-micro ease-standard hover:text-on-ground"
                  >
                    <span className="font-mono text-label tabular-nums text-accent-on-ground">
                      {step.number}
                    </span>
                    <span className="text-body text-on-ground-muted">{step.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The four steps                                                    */}
      {/* ---------------------------------------------------------------- */}

      <section className="ground-paper border-y border-hairline">
        <div className="mx-auto w-full max-w-page px-5 md:px-8">
          <ol>
            {STEPS.map((step, index) => (
              <li
                key={step.id}
                id={step.id}
                className={`grid scroll-mt-8 gap-6 py-12 md:py-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12 ${
                  index > 0 ? 'border-t border-hairline' : ''
                }`}
              >
                <div className="flex items-baseline gap-5 lg:flex-col lg:gap-4">
                  <span className="font-mono text-h1 tabular-nums text-accent-on-ground" aria-hidden>
                    {step.number}
                  </span>
                  <h2 className="font-heading text-h1 text-on-ground">{step.title}</h2>
                </div>

                <p className="text-lead text-on-ground-muted">{step.body}</p>

                <div className="border-l-2 border-hairline pl-6">
                  <p className="font-mono text-label uppercase text-accent-on-ground">Will not</p>
                  <p className="mt-3 text-body text-on-ground-muted">{step.refusal}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The limits — dark, because they are the shape of the product      */}
      {/* ---------------------------------------------------------------- */}

      <section className="ground-ink">
        <div className="mx-auto w-full max-w-page px-5 py-20 md:px-8 md:py-28">
          <div className="max-w-prose">
            <p className="font-mono text-label uppercase text-on-ground-muted">The edges</p>
            <h2 className="mt-5 font-heading text-title text-on-ground">What it will not do</h2>
            <p className="mt-5 text-lead text-on-ground-muted">
              Worth knowing before you start, so none of it is a surprise in week one.
            </p>
          </div>

          <ul className="mt-14 grid gap-x-16 gap-y-10 md:mt-16 md:grid-cols-2">
            {LIMITS.map((limit) => (
              <li key={limit.title} className="border-t border-hairline pt-6">
                <h3 className="font-heading text-h2 text-on-ground">{limit.title}</h3>
                <p className="mt-3 max-w-prose text-body text-on-ground-muted">{limit.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The single conversion point on this page                          */}
      {/* ---------------------------------------------------------------- */}

      <section className="ground-brand">
        <div className="mx-auto flex w-full max-w-page flex-col gap-8 px-5 py-14 md:flex-row md:items-center md:justify-between md:px-8 md:py-16">
          <div className="max-w-prose">
            <h2 className="font-heading text-title text-on-ground">That is the whole of it</h2>
            <p className="mt-4 text-lead text-on-ground-muted">
              Two conferences free, no card, and your existing Google Form on the front of it.
            </p>
          </div>
          <Button variant="secondary" className="shrink-0 self-start md:self-auto" asChild>
            <Link href="/sign-in">
              Start a conference
              <ArrowRight size={16} aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}
