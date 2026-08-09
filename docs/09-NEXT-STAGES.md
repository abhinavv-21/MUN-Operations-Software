# Next stages

Stages 7 and 8, restated from the original specification with what this build already did.

**Every stage ends deployable.** Do not start one until the previous exit criterion passes, and show
the exit criterion output before moving on.

---

## Stage 7 — conference-day operations

Everything the organising committee touches on the day.

### Build

- **Attendance check-in** — per delegate, per conference.
- **`LogisticsReq`** — categories, statuses, resolution.
- **Awards** — per committee.
- **Exporters** — CSV, XLSX, PDF.
- **The audit-log viewer**, with filters.
- **The dashboard.**
- **A Dexie offline queue for exactly two writes**, a service worker, and a connection pill.

### The part that matters most

**The offline queue holds exactly two writes: a logistics request and an attendance check-in.**
Everything else fails fast, deliberately.

Queueing a delegate edit means queueing a conflict you cannot resolve later without showing the user
a merge dialog they will not understand. Two people must not both believe they hold the truth.

This is why `networkMode: 'always'` is already set on mutations in `src/app/providers.tsx` — React
Query's default *pauses* a mutation while the browser reports itself offline, so an edit on venue
wifi sat on "Saving" indefinitely with no error and no way out. The two writes that genuinely should
survive being offline will call `apiFetch` directly and queue on its `code: 0` error.

Read the comment in `providers.tsx` before touching any of this; it carries the full reasoning.

### Worth porting from the predecessor

`exporters.ts`, the attendance/logistics/awards route logic, `offline.ts` and its two-writes-only
policy, `ConnectionPill` and `UpdatePrompt`. `SaveIndicator` is already ported.

Everything new is conference-scoped: add each model to `TENANT_MODELS`, and repeat the RLS block in
the migration. The coverage test and the RLS test will both fail until you do — that is them working.

### Exit criterion

- With devtools set to Offline, a logistics request **and** an attendance check-in both queue and
  then land in the database on reconnect.
- Editing a delegate offline fails **immediately** with "you appear to be offline" rather than
  hanging. This is the venue-wifi bug the `networkMode: 'always'` decision exists for.
- A test walks the route manifest and asserts every mutating admin route writes an `AuditLog` row.

---

## Stage 8 — organisation administration, marketing, hardening

An organiser runs their organisation without emailing you.

### Build

- The members screen — **already built**: invite, role change, remove, last-owner protection.
  Ownership transfer has a service and a route but no UI control.
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
  permission-denied while the app works normally. **Already true and verified**, but re-check after
  Stage 7 adds tables.
- The last OWNER cannot demote or remove themselves. **Already true and tested.**
- Lighthouse ≥ 90 on the marketing page and the public registration page.
- `npm run typecheck` clean, `npm test` green, production deploy from `main`.

---

## Smaller gaps worth folding in

| Gap | Where it stands |
| --- | --- |
| Conference settings form | Service, schema, route and validation all exist and are tested |
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
