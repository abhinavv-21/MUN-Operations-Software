# Kickstart prompt

Paste everything below the line into a fresh session, from the repository root.

---

You are continuing work on **MUN Operations Software**, a multi-tenant SaaS that runs the operations
of a Model UN conference. Anyone signs up and gets an **organisation**; an organisation runs one or
more **conferences**. The organisation is the billing and membership boundary; **the conference is
the data boundary**.

Repository: <https://github.com/abhinavv-21/MUN-Operations-Software>
Deployed: <https://munopshub.vercel.app>
Working directory: `~/projects/mun-ops` — **not** the `D:` drive. Small-file reads are ~158× slower
across the Windows mount.

**Stages 1–6 of 8 are complete, deployed, and green.** Stage 7 is next.

## Read these first

The `docs/` folder exists so you do not have to re-derive any of this. Read, in order:

1. `docs/01-CURRENT-STATE.md` — what is built, what is deferred, and the **do not build in v1** list
2. `docs/02-INVARIANTS.md` — eight rules, the mechanism enforcing each, and the command that proves it
3. `docs/03-ARCHITECTURE.md` — tenancy, context, services, the error contract
4. `docs/07-TRAPS.md` — every defect found in this build and the lesson from each

Then `04` (stack), `05` (design), `06` (environment), `08` (testing) and `09` (next stages) as the
work touches them. `docs/README.md` has a "read this before you…" table.

`docs/REFERENCE-LRI-MUN-X.md` describes the **single-tenant predecessor** this product replaces.
Read it for the error contract, audit trail, serializable allocation and ingestion aliases. Its
auth, hosting and rate-limiting decisions are marked DO NOT CARRY and mean it.

## Hold these invariants

State them back before you start, and hold them for the whole build.

1. **The error contract.** Every API failure is `{ error, code, details? }`. No exceptions, no bare
   `NextResponse.json({ message })`. 422 for validation with `[{ path, message }]`. **404, not 403,
   for "exists but is not yours"** — a 403 confirms the resource exists.
2. **The tenancy rule.** No module outside `src/server/db.ts` imports the raw client. Everything
   goes through `ctx.db`, already scoped. Raw SQL is banned by lint for the same reason.
3. **Authorization lives in the service layer**, not the route handler. Server Components call
   services directly, so a check that lives only in a route handler does not run for the first
   paint.
4. **No arbitrary colour values.** No hex, no `rgb()`, no `bg-[#...]` outside the theme layer.
   `npm run lint` fails on one.
5. **Tests skip with a printed reason when Postgres is unreachable**, and *fail* when `CI` is set.
6. **Every model is classified** in `src/server/models.ts`. A test fails until it is.
7. **Every migration that adds a table enables RLS.** Supabase serves PostgREST over `public` to
   anyone holding the anon key, and a new table arrives with RLS off.
8. **Browser env values are read as literal `process.env.NEXT_PUBLIC_FOO`**, never a computed key.

## How to work

- **Verify assumptions rather than porting them.** The predecessor's reasoning is sound; several of
  its *mechanisms* broke under Prisma 7, Tailwind 4 and Next 16. `docs/04-STACK-DECISIONS.md` lists
  every divergence. **Where the old specification and this repository disagree, the repository is
  correct.**
- **Prove a security fix by reverting it** and watching the test fail. A test that passes after a
  fix has not demonstrated it catches anything.
- **Run the thing before claiming it works.** `npm run typecheck && npm run lint && npm test &&
  npm run build`, and hit the endpoint. If verification is impossible, say so plainly.
- **Report failures faithfully.** If a test fails, show the output. If you skipped something, say
  which and why.
- **Commit style:** sentence-form, imperative, capitalised, no trailing period, no
  conventional-commit prefixes. Describe the user-visible effect or the reason, not the files
  touched. Never add yourself as co-author.
- **No credentials in any committed file.** `.env` and `.env.supabase` are gitignored and are the
  only home for real values. `docs/06-ENVIRONMENT.md` lists variable names and sources only.
- Be direct and plainspoken. No em dashes. Lead with what is wrong when asked for an opinion.

## Starting up

```bash
mun-pg start          # WSL runs no init; the cluster does not survive a reboot
npm test              # confirm green before changing anything
```

## Your task

**Build Stage 7 — conference-day operations.** The brief and exit criterion are in
`docs/09-NEXT-STAGES.md`. In short: attendance check-in, logistics requests, awards, CSV/XLSX/PDF
exporters, the audit-log viewer, the dashboard, and a Dexie offline queue holding **exactly two
writes** — a logistics request and an attendance check-in. Everything else fails fast, deliberately.

Read the comment in `src/app/providers.tsx` about `networkMode: 'always'` before touching anything
offline-related; it carries the reasoning the exit criterion tests.

Exit criterion:

- With devtools set to Offline, a logistics request and an attendance check-in both queue and land
  in the database on reconnect.
- Editing a delegate offline fails **immediately** with "you appear to be offline" rather than
  hanging.
- A test walks the route manifest and asserts every mutating admin route writes an `AuditLog` row.

Show me the exit criterion output before moving on to Stage 8.
