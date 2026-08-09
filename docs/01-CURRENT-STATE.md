# Current state

What exists, what does not, and what must not be built.

| | |
| --- | --- |
| Repository | <https://github.com/abhinavv-21/MUN-Operations-Software> |
| Deployment | <https://munopshub.vercel.app> |
| Local path | `~/projects/mun-ops` (**not** the `D:` drive — see `06-ENVIRONMENT.md`) |
| Stages complete | 1–6 of 8 |

Numbers drift. `npm test` is the source of truth for the suite, `git log --oneline` for history.

---

## What the product is

Multi-tenant SaaS that runs the operations of a Model UN conference.

Anyone signs up and gets an **organisation**. An organisation runs one or more **conferences**.
The organisation is the billing and membership boundary; **the conference is the data boundary**,
and every operational table is scoped to one.

---

## Built, by stage

Each stage had an exit criterion in the original specification. All six passed with evidence, not
assertion.

**Stage 1 — skeleton, database, tenancy guarantee.**
Next.js App Router, Prisma 7 against Supabase Postgres, the `scope()` client extension,
model-classification coverage test, `createCtx`, `withApi`, `/api/health`, deny-all RLS.
*Proved:* cross-tenant read returns nothing; cross-tenant update surfaces as 404; scoping survives
`$transaction`; the Prisma role has `BYPASSRLS` (verified against Supabase, not assumed).

**Stage 2 — identity, organisations, membership, invitations.**
Supabase Auth with cookie sessions, Edge `proxy.ts` refreshing them, local JWKS verification with
`jose`, JIT provisioning, effective-role resolution, invitations with SHA-256 token hashes, audit
rows on every membership change.
*Proved:* a non-member gets **404, not 403**, byte-identical to a slug that never existed; the last
OWNER cannot be demoted or removed; a token is spent exactly once.

**Stage 3 — theming and the design system.**
Every colour derives from four seed colours on a database row, expanded in OKLCH and injected into
the first byte. The UI kit ported from the predecessor.
*Proved:* editing the row changes the product with no rebuild; the variables precede content with
JavaScript disabled; six seeds including a deliberately awful pale yellow all clear 4.5:1; CI fails
on an introduced `bg-[#fff]`.

**Stage 4 — conferences, committees, the client data layer.**
Conference and committee CRUD, plan limits, TanStack Query with the predecessor's defaults carried
verbatim.
*Proved:* a conference id from another organisation is 404 on read *and* write; the third
conference on a free plan is 403 carrying `details.limit`; two conferences in one organisation can
both have a `UNSC`.

**Stage 5 — public registration and ingestion.**
The public page, honeypot, Upstash rate limiting, presigned uploads on Backblaze, the review queue,
CSV import, the Google Sheets webhook and its Apps Script generator.
*Proved:* two submissions of one email return identical 201s with one row behind them; a filled
honeypot writes nothing; a real Forms export imports and reports its `Committee` column as ignored;
a script repointed at another conference gets 401.

**Stage 6 — delegates, allocations, country matrix.**
Allocation inside a serializable transaction, the matrix parser in both shapes, the delegates and
allocations screens.
*Proved:* eight parallel allocations of one country produce exactly one 201, seven 409s, one row
and **no 500**; a matrix naming an unknown committee creates no committee.

**Added early, ahead of the specification:** CI running typecheck, lint, tests and build on every
push (the spec deferred this to Stage 8 — it caught a config bug on its first run), and three
security headers in `next.config.ts`.

---

## Not built

Honest gaps, roughly in the order they hurt.

- **Stage 7 entirely** — attendance, logistics requests, awards, exporters, the audit-log viewer,
  the dashboard, the offline queue, service worker, connection pill. See `09-NEXT-STAGES.md`.
- **Stage 8 entirely** — the members screen exists, but org settings, conference archive, the
  danger zone, the usage panel, CSP and the marketing pages do not.
- **Conference settings form.** `updateConference` and its `PATCH` route exist and are tested;
  dates, venue, fee and deadline can only be set through the API today.
- **`prisma/seed.ts`.** No seed exists. Test fixtures are built inline.

---

## Do not build in v1

Carried from the original specification. Each looks essential and none blocks a first paying
organiser. A new session will otherwise helpfully build one of them.

1. **Anything Stripe-adjacent**, including a pricing page with real prices. `Organization.planLimits`
   *is* the upgrade flow: a customer emails and their ceiling becomes a row update.
2. **Custom domains or per-conference subdomains.** `/r/[org]/[conference]` covers v1 entirely.
3. **Dark mode.** The ground-class model makes it purely additive later.
4. **A custom registration form builder.** Organisers will ask in week one. The answer is that
   **their Google Form already is their custom form** — header-alias ingestion is what makes that
   true, and it is built. Not even a `customFields` JSON blob.
5. **Google OAuth into Drive or Sheets for two-way sync.** One-way webhook plus CSV only.
6. **Any email the product sends itself.** Supabase handles confirmation. No delegate
   confirmations, no bulk mail. This is the single largest hidden support burden in the plan.
7. **Real-time, Supabase Realtime, websockets.** The predecessor ran an entire conference on
   refetch-on-focus.
8. **Per-committee permissions.** Two conference roles ran a real conference.
9. **Online fee collection from delegates.** Screenshot upload plus manual review is what works and
   avoids becoming a payment processor for other people's money.
10. **i18n, native apps, SSO/SAML, SOC 2 artefacts, multi-region, read replicas.**
11. **Soft-delete and undo everywhere.** The audit log plus a typed-confirmation danger zone is the
    v1 answer to "I deleted it by mistake".
12. **A marketing CMS.** MDX in the repository.
