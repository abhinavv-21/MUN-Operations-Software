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
 * Each step says what the product refuses to do as well as what it does — the
 * refusals are the design, and an organiser who discovers them on the day has
 * been misled by the page that brought them here.
 */

const STEPS = [
  {
    number: '01',
    title: 'Applications arrive',
    body: 'Publish a registration page for the conference and share the link, or point the Google Form your society already uses at it. Column names are matched to fields, so "Student Name" and "Full name" land in the same place.',
    refusal:
      'It never creates an account for an applicant. Registering does not put anybody inside your organisation.',
  },
  {
    number: '02',
    title: 'You review them',
    body: 'Applications sit in a queue with the school, the previous MUNs and the payment screenshot. Approving one creates a delegate. Rejecting one takes a reason, because "why was I turned down" gets asked in March.',
    refusal:
      'Approving never allocates. The committee somebody asked for is stored and acted on by nobody.',
  },
  {
    number: '03',
    title: 'You allocate',
    body: 'Import the country matrix as a column per committee or a row per seat. Allocate delegates against it, with seat capacity enforced as you go — two people allocating the last seat in UNSC at the same moment get one seat and one clear message.',
    refusal:
      'A committee with no matrix is unconstrained rather than broken, so one committee can be finalised while five are still being argued about.',
  },
  {
    number: '04',
    title: 'The conference runs',
    body: 'Check delegates in each morning, raise logistics requests from wherever the problem is, and record awards committee by committee. Export any of it to CSV, Excel or PDF. Every change is in an audit log with who made it.',
    refusal:
      'Check-ins and logistics requests survive a dead network. Everything else refuses to save rather than pretending.',
  },
]

export default function HowItWorksPage() {
  return (
    <>
      <section className="mx-auto w-full max-w-app px-5 py-16 md:px-8">
        <div className="max-w-prose">
          <p className="text-label uppercase text-ink-secondary">How it works</p>
          <h1 className="mt-3 font-heading text-display text-ink">
            From a form to closing ceremony
          </h1>
          <span className="page-rule mt-4 block" aria-hidden />
          <p className="mt-6 text-body text-ink-secondary">
            Four steps, in the order they happen. Each one also says what the product deliberately
            will not do, because those are the decisions you will notice.
          </p>
        </div>
      </section>

      <section className="border-t border-edge bg-surface">
        <div className="mx-auto w-full max-w-app px-5 py-14 md:px-8">
          <ol className="flex flex-col gap-10">
            {STEPS.map((step) => (
              <li key={step.number} className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-8">
                <span
                  className="font-mono text-h1 tabular-nums text-accent"
                  aria-hidden
                >
                  {step.number}
                </span>
                <div className="max-w-prose">
                  <h2 className="text-h2 text-ink">{step.title}</h2>
                  <p className="mt-2 text-body text-ink-secondary">{step.body}</p>
                  <p className="mt-3 border-l-2 border-edge-strong pl-4 text-body-sm text-ink-secondary">
                    {step.refusal}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-app px-5 py-16 md:px-8">
        <div className="max-w-prose">
          <h2 className="font-heading text-h1 text-ink">What it will not do</h2>
          <p className="mt-3 text-body text-ink-secondary">
            Worth knowing before you start, so nothing is a surprise in week one.
          </p>

          <ul className="mt-6 flex flex-col gap-3 text-body text-ink-secondary">
            {[
              'It sends no email of its own. Invitation links are yours to forward, from the mail client you already use.',
              'It takes no payments from delegates. Upload a screenshot, mark it reviewed — being a payment processor for other people’s money is a different product.',
              'There is no form builder. Your Google Form is your custom form.',
              'There is no dark mode yet, and no mobile app. The web app is built for a phone held in one hand at a registration desk.',
            ].map((item) => (
              <li key={item} className="border-l-2 border-edge pl-4">
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <Button asChild>
              <Link href="/sign-in">
                Start a conference
                <ArrowRight size={16} aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
