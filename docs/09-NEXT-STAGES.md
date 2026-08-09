# Stages 7 and 8

**All eight stages are complete.** This is the record of what the last two built and why, kept
because the decisions in them are the ones a later session is most likely to undo by accident.

For what to do next, see the bottom of this file and the **do not build in v1** list in
`01-CURRENT-STATE.md` — which is still the list, and is still what a fresh session will helpfully
start building.

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

## Stage 8 — organisation administration, marketing, hardening — **complete**

An organiser runs their organisation without emailing you.

### What landed

- **Organisation settings** — name, address, branding with a live preview derived by the same
  `buildThemeVars` the server uses, and the usage panel from `computeUsage`.
- **The organisation-wide audit log**, which had to exist once conferences could be deleted.
- **Conference settings** — dates, venue, fee, deadline, status — and a **danger zone** with archive
  (reversible) and delete (typed confirmation, checked in the service).
- **Ownership transfer UI**, calling the endpoint that had existed since Stage 2 with nothing
  reaching it.
- **Inline committee seat editing**, likewise: `updateCommittee` was unreachable from the product,
  which meant seat capacity and the serializable allocation behind it could only be set by API.
- **A nonce-based CSP** and five more security headers.
- **Two marketing pages**, `/` and `/how-it-works`, in a route group.

### Decisions worth knowing before changing any of it

**`customBranding` is now enforced.** It had sat in the plan table since Stage 1 with nothing reading
it, which made it a claim the product did not keep. Presets are free; changing one of a preset's
colours is the gated part. Lifted by a row update on `planLimits`, like every other limit.

**`AuditLog.conferenceId` became `SetNull`.** Under the `Cascade` it had, deleting a conference
destroyed every row recording what had been done to it — including the row recording the deletion.
That made "the audit log is the answer to *I deleted it by mistake*" false at the one moment it
mattered. Proven by putting the cascade back and watching the test go red.

**The CSP nonce means nothing is statically prerendered.** Accepted after measuring, not before. See
invariant 11 and trap 16.

**Slug changes are allowed**, with a warning naming exactly what breaks and an audit row carrying the
old value. The alternative — a typo at sign-up being permanent — is the kind of thing that generates
the email this stage exists to prevent.

### Exit criterion — met

```
PostgREST with the publishable anon key, against the live project:
  AttendanceRecord   -> 42501      LogisticsRequest   -> 42501
  Award              -> 42501      Delegate           -> 42501   (control)

The last OWNER cannot demote or remove themselves        — tests/membership.test.ts
Lighthouse, desktop preset:
  landing          perf 100  a11y 100  best-practices 100  seo 100
  how-it-works     perf 100  a11y 100  best-practices 100  seo 100
  registration     perf 100  a11y 100  best-practices 100  seo  90

npm run typecheck   clean
npm test            243 passing, 21 files
npm run build       clean
```

The registration page's SEO 90 is a single audit — `meta-description` — and the tag **is** served:
`curl` shows it in the initial HTML. It is an artefact of Lighthouse reading the rendered DOM while
Next streams metadata, not a missing tag.

---

## Smaller gaps worth folding in

| Gap | Where it stands |
| --- | --- |
| PDF in non-Latin scripts | Standard-14 fonts only, so `?` for Devanagari and CJK. Needs an embedded font subset |
| Logo upload | `Theme.logoUrl` exists and nothing sets it. Needs an organisation-scoped presigned endpoint |
| Deleting an organisation | Conferences can go; closing an account is an email. Deliberate for v1 |
| `prisma/seed.ts` | Does not exist. Fixtures are built inline in tests |
| Product name | One constant in `src/lib/product.ts`. Renaming is a one-line change — candidates were **Placard**, **Dais**, **Quorum** |

---

## What is worth doing next

v1 is feature-complete against the original specification. Nothing below is required to run a
conference, and the **do not build in v1** list still applies to all of it.

In the order the product would feel it:

1. **`prisma/seed.ts`.** The one piece of ordinary developer comfort that is missing. Every browser
   check in this repository seeds its own fixture with raw SQL, which is a sign.
2. **Logo upload.** The first thing an organiser will ask for after seeing the branding screen, and
   the reason `Theme.logoUrl` is already in the schema.
3. **An embedded font for the PDF**, so a delegate whose name is in Devanagari is not printed as
   `???` at their own conference.
4. **A second pair of eyes on the CSP.** It is the newest control and the one with the least
   operational history — `report-uri` to somewhere real would be the honest next step, once there is
   somebody to read it.

## Before starting anything

1. `mun-pg start`, then `npm test` — confirm green before changing anything.
2. Read `01-CURRENT-STATE.md` for the **do not build in v1** list. A new session will otherwise
   helpfully build a form builder, or a pricing page, or email sending.
3. Read `02-INVARIANTS.md`. Adding a table without classifying it, or without RLS, fails CI — by
   design, but knowing why saves a confused half hour.
4. If you touch anything the browser decides — the CSP, the offline queue, an inline `<style>` —
   run the two scripts in `08-TESTING.md`. No server-side check can see those failures.
