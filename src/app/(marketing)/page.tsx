import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ArrowRight,
  ClipboardCheck,
  Globe2,
  Inbox,
  ScrollText,
  WifiOff,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product.ts'

export const metadata: Metadata = {
  // The root layout's template appends the product name; the landing page is
  // the one place that would then say it twice.
  title: { absolute: `${PRODUCT_NAME} — run your Model UN conference` },
  description: PRODUCT_DESCRIPTION,
}

/**
 * The landing page.
 *
 * No session, no database, no client component — but **not statically
 * prerendered**, because the root layout reads the CSP nonce out of the request
 * headers and a nonce cannot exist before a request does. That costs the CDN
 * cache and buys a policy without `'unsafe-inline'`; the trade is argued in
 * `src/lib/csp.ts`. It still measures 100 for performance, which is the number
 * the trade had to survive.
 *
 * Written about the day rather than about the feature list. Every organiser
 * reading this has already run a conference on a shared spreadsheet and knows
 * exactly which hour of it went wrong.
 */
export default function HomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-app px-5 py-16 md:px-8 md:py-24">
        <div className="max-w-prose">
          <p className="text-label uppercase text-ink-secondary">Model UN, run properly</p>
          <h1 className="mt-3 font-heading text-display text-ink">
            Everything your conference needs, in one place.
          </h1>
          <span className="page-rule mt-4 block" aria-hidden />

          <p className="mt-6 text-body text-ink-secondary">
            Registrations, committees, the country matrix, allocations, attendance, logistics and
            awards — for one conference, or for every edition your society has ever run. Built by
            people who have run the spreadsheet version and would like never to do it again.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link href="/sign-in">
                Start a conference
                <ArrowRight size={16} aria-hidden />
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/how-it-works">See how it works</Link>
            </Button>
          </div>

          <p className="mt-4 text-body-sm text-ink-secondary">
            Free for two conferences. No card, and nothing to cancel.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}

      <section className="border-y border-edge bg-surface">
        <div className="mx-auto w-full max-w-app px-5 py-14 md:px-8">
          <h2 className="max-w-prose font-heading text-h1 text-ink">
            The three hours that decide whether a conference runs well
          </h2>
          <p className="mt-3 max-w-prose text-body text-ink-secondary">
            Not the six months of planning. The morning of day one, the middle of session two, and
            the ten minutes before closing ceremony.
          </p>

          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              {
                icon: ClipboardCheck,
                title: 'The registration desk, 08:40',
                body: 'Three hundred delegates in a queue and one person with a printed list. Check them in by name or committee, on a phone, and watch the count of who has not arrived.',
              },
              {
                icon: Wrench,
                title: 'A basement committee room, 11:15',
                body: 'The projector has no signal and the room has no wifi. The request still gets raised, and it reaches whoever is running the moment there is a bar of signal.',
              },
              {
                icon: ScrollText,
                title: 'The dais, 17:50',
                body: 'Awards read committee by committee, best first, off a list that cannot contain a delegate who is not in that committee.',
              },
            ].map((item) => (
              <div key={item.title}>
                <item.icon size={22} className="text-accent" aria-hidden />
                <h3 className="mt-3 text-h3 text-ink">{item.title}</h3>
                <p className="mt-2 text-body-sm text-ink-secondary">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}

      <section className="mx-auto w-full max-w-app px-5 py-16 md:px-8">
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="max-w-prose">
            <WifiOff size={22} className="text-accent" aria-hidden />
            <h2 className="mt-3 font-heading text-h1 text-ink">It works on venue wifi</h2>
            <p className="mt-4 text-body text-ink-secondary">
              Attendance check-ins and logistics requests are saved on the device and sent the
              moment the connection returns. Both are safe to send twice, so a bad network costs you
              nothing.
            </p>
            <p className="mt-4 text-body text-ink-secondary">
              Everything else tells you immediately that it could not save, rather than spinning on{' '}
              <span className="text-ink">Saving</span> until somebody walks away. Two people should
              never both believe they hold the truth.
            </p>
          </div>

          <div className="max-w-prose">
            <Globe2 size={22} className="text-accent" aria-hidden />
            <h2 className="mt-3 font-heading text-h1 text-ink">Your Google Form already works</h2>
            <p className="mt-4 text-body text-ink-secondary">
              There is no form builder to learn. Point the form you already have at your conference,
              or paste a CSV export, and the columns are matched to fields by name — including the
              ones your society renamed three editions ago.
            </p>
            <p className="mt-4 text-body text-ink-secondary">
              Applications land in a review queue. Approving one creates a delegate; it never
              allocates them, because a form answer is a wish and an allocation is a decision.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}

      <section className="border-t border-edge bg-surface">
        <div className="mx-auto w-full max-w-app px-5 py-14 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-prose">
              <Inbox size={22} className="text-accent" aria-hidden />
              <h2 className="mt-3 font-heading text-h1 text-ink">
                One account, every edition you run
              </h2>
              <p className="mt-3 text-body text-ink-secondary">
                A society is not one conference. MUN X stays exactly as it finished while MUN XI is
                being built, and the same student registering for both is one person in two places
                rather than a duplicate to clean up.
              </p>
              <p className="mt-3 text-body-sm text-ink-secondary">
                Plans are simple: two conferences free, more on request. Email us and we raise the
                limit — there is no upgrade page to hunt for.
              </p>
            </div>

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
