# Next stages

Stages 7 and 8, restated from the original specification with what this build already did.

**Every stage ends deployable.** Do not start one until the previous exit criterion passes, and show
the exit criterion output before moving on.

---

## Stage 7 — conference-day operations — **complete**

Everything the organising committee touches on the day. Built, deployed-ready and green.

### What landed

- **Attendance** — `AttendanceRecord`, keyed `(conference, delegate, day)`. CONTRIBUTOR may mark.
- **`LogisticsRequest`** — categories, priorities, statuses, resolution required to close.
- **Awards** — per committee, free-text titles, the delegate must sit in the committee.
- **Exporters** — CSV, XLSX and PDF, all hand-written, no new dependency. See below.
- **The audit-log viewer**, conference-scoped, admin only, cursor-paged on uuidv7 ids.
- **The dashboard**, now the conference root page; committees moved to `/committees`.
- **A conference sub-navigation**, because nine screens with no navigation is unusable.
- **Delegate editing**, which did not exist and which the exit criterion needs — it is the write
  that must *not* queue.
- **The Dexie offline queue**, a service worker, an offline page, a connection pill and an update
  prompt.

### Decisions worth knowing before changing any of it

**The exporters are hand-written on purpose.** `pdfkit` reads `.afm` font metrics from disk at
runtime, which a serverless bundle does not carry; `exceljs` pulls a stream and zip stack that has
to be marked external; SheetJS is no longer on npm. All three are deployment problems, not size
problems. What replaced them is ~450 lines with no runtime dependency beyond `node:zlib`, and
`tests/exporters.test.ts` unzips the workbook and walks the PDF cross-reference table rather than
trusting either.

**The PDF sets its table in Courier.** Proportional layout needs a per-glyph width table, and one
transcribed by hand is a silent layout bug waiting for the wrong string. Courier is exactly 600/1000
em, so every measurement is a multiplication that cannot be subtly wrong.

**CSV neutralises formulas; XLSX does not need to.** Delegate names arrive through the public form,
so `=HYPERLINK(...)` as a name is a real payload against the organiser who opens the export. CSV
prefixes an apostrophe; the XLSX writes every string as `t="inlineStr"`, which Excel never
evaluates.

**`ORG_REVOCABLE_MODELS` was added to the tenancy extension.** Narrowly — see `02-INVARIANTS.md` #2
and `07-TRAPS.md` #14.

### Exit criterion — met

```
▸ Criterion 1a — an attendance check-in, made offline
  ✓ nothing reached the database, because there is no network
  ✓ it is in the Dexie queue
▸ Criterion 1b — a logistics request, made offline
  ✓ both writes are in one queue, in the order they were made
▸ Criterion 2 — editing a delegate offline fails immediately
  ✓ it failed in 133 ms rather than hanging on "Saving"
  ✓ the edit was NOT queued — the queue still holds exactly the two writes
▸ Reconnecting
  ✓ both writes landed in Postgres (attendance/logistics = 1/1)
```

Run it with `npm run build && node scripts/e2e-offline.mjs`. The third clause — the route manifest —
is `npx vitest run tests/audit.manifest.test.ts`.

---

## Stage 8 — organisation administration, marketing, hardening

An organiser runs their organisation without emailing you.

### Build

- The members screen — **already built**: invite, role change, remove, last-owner protection.
  Ownership transfer has a service and a route but no UI control. (Removal only started working in
  Stage 7 — `07-TRAPS.md` #14.)
- Organisation settings, including branding — the theme service and schema exist; there is no form.
- **Conference settings** — dates, venue, fee, deadline, status, theme. `updateConference` and its
  `PATCH` route exist and are tested; only the form is missing. Arguably belongs earlier.
- Conference archive and a typed-confirmation danger zone.
- A usage panel from `computeUsage` — **already written** in `src/server/limits.ts`, unused.
- CSP and the remaining security headers in `next.config.ts` — three are already set.
- `EXPOSE_ERROR_DETAILS` failing closed — **already done and tested**.
- Marketing pages using the ground classes.
- **CI running typecheck, test and lint on every PR — already done in Stage 1.** It caught a config
  bug on its first run.

### Exit criterion

- With the publishable anon key, `curl` against PostgREST for `/rest/v1/Delegate` returns
  permission-denied while the app works normally. **Already true and verified.** Stage 7 added
  `AttendanceRecord`, `LogisticsRequest` and `Award`; all three carry RLS, asserted by
  `tests/security.rls.test.ts`, but the live PostgREST check should be repeated against Supabase
  once they are deployed.
- The last OWNER cannot demote or remove themselves. **Already true and tested.**
- Lighthouse ≥ 90 on the marketing page and the public registration page.
- `npm run typecheck` clean, `npm test` green, production deploy from `main`.

---

## Smaller gaps worth folding in

| Gap | Where it stands |
| --- | --- |
| Conference settings form | Service, schema, route and validation all exist and are tested |
| Organisation-level audit viewer | The conference viewer exists; rows with a null `conferenceId` have no screen |
| PDF in non-Latin scripts | Standard-14 fonts only, so `?` for Devanagari and CJK. Needs an embedded font subset |
| Ownership transfer UI | `POST /api/orgs/[orgSlug]/transfer-ownership` exists; no control calls it |
| Committee seat editing | `updateCommittee` exists; the UI only creates and deletes |
| `prisma/seed.ts` | Does not exist. Fixtures are built inline in tests |
| Product name | One constant in `src/lib/product.ts`. Renaming is a one-line change — candidates were **Placard**, **Dais**, **Quorum** |

---

## Before starting either stage

1. `mun-pg start`, then `npm test` — confirm green before changing anything.
2. Read `01-CURRENT-STATE.md` for the **do not build in v1** list. A new session will otherwise
   helpfully build a form builder, or a pricing page, or email sending.
3. Read `02-INVARIANTS.md`. Adding a table without classifying it, or without RLS, fails CI — by
   design, but knowing why saves a confused half hour.
