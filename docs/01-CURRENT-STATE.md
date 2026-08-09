# Current state

What exists, what does not, and what must not be built.

| | |
| --- | --- |
| Repository | <https://github.com/abhinavv-21/MUN-Operations-Software> |
| Deployment | <https://munopshub.vercel.app> |
| Local path | `~/projects/mun-ops` (**not** the `D:` drive — see `06-ENVIRONMENT.md`) |
| Stages complete | 1–8 of 8 |

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

**Stage 7 — conference-day operations.**
Attendance, logistics requests, awards, CSV/XLSX/PDF exporters, the audit-log viewer, the conference
dashboard, a conference sub-navigation, delegate editing, and the Dexie offline queue with its
service worker, connection pill and update prompt.
*Proved:* in a real headless Chrome with `Network.emulateNetworkConditions { offline: true }` — the
same command the devtools Offline checkbox sends — a logistics request and an attendance check-in
both queue and both land in Postgres on reconnect; a delegate edit fails in **138 ms** with "You
appear to be offline" rather than hanging; the queue survives a reload while still offline. Reverting
`networkMode: 'always'` makes the check-in hang and never queue, which is the bug that decision
exists for. A three-layer manifest test asserts every mutating admin route writes an `AuditLog` row,
and each layer was confirmed by breaking it.

**Stage 8 — organisation administration, marketing, hardening.**
Organisation settings with branding and a live preview, the usage panel, the conference settings
form, a typed-confirmation danger zone with archive and delete, the organisation-wide audit log,
ownership-transfer UI, inline committee seat editing, a nonce-based CSP with the remaining security
headers, and two marketing pages.
*Proved:* PostgREST answers `42501` for all three Stage 7 tables against the live Supabase project
while the app works normally; the last OWNER still cannot demote or remove themselves; Lighthouse
scores **100/100/100/100** on the landing page and how-it-works and **100/100/100/90** on the public
registration page; the CSP holds in a real headless Chrome across six page types with React
hydrating on every one.

**Added early, ahead of the specification:** CI running typecheck, lint, tests and build on every
push (the spec deferred this to Stage 8 — it caught a config bug on its first run), and three
security headers in `next.config.ts`.

---

## Not built

Honest gaps, roughly in the order they hurt.

- **`prisma/seed.ts`.** No seed exists. Test fixtures are built inline.
- **No logo upload.** `Theme.logoUrl` exists in the schema and nothing sets it: uploading one needs
  an organisation-scoped presigned endpoint, and the only one built is for payment proofs on the
  public form. The branding screen therefore offers colours, corners and a typeface, and no crest.
- **Deleting an organisation is not possible in the product.** Conferences can be archived or
  deleted; closing the whole account is an email. Deliberate for v1 — the failure mode of getting it
  wrong is losing every conference a society has ever run.
- **The PDF exporter cannot render non-Latin scripts.** It uses the standard-14 fonts, which need no
  font file and therefore cannot break a serverless bundle, but which cover WinAnsi only. A name in
  Devanagari, Arabic or a CJK script is written as `?`. CSV and XLSX are full UTF-8, which is why the
  export screen offers three formats and says so on the PDF button.
- **The service worker only updates when `public/sw.js` changes.** `CACHE_VERSION` is the trigger.
  A deploy that does not touch that file ships no update prompt — which is safe, because every URL
  it caches is content-hashed, but it means the prompt is not a deploy notification.
- **Nothing is statically prerendered any more.** The CSP nonce is per request and the root layout
  reads it, so every route renders on demand. Measured before accepting it: the marketing pages
  still score 100 for performance. The trade is written up in `src/lib/csp.ts`.
- **No dark mode, and no `prefers-color-scheme` handling.** Still deliberate, still purely additive
  later because of the ground-class model.

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
