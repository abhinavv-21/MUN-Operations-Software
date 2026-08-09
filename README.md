# MUN Operations Software

Multi-tenant SaaS that runs the operations of a Model UN conference: committees, country matrix, delegates, registrations, allocations, logistics, attendance, awards, exports and an audit log.

Anyone signs up and gets an **organisation**.
An organisation runs one or more **conferences**.
The organisation is the billing and membership boundary; the conference is the data boundary.

The single-tenant predecessor that served a real conference is [lrimunx](https://github.com/abhinavv-21/lrimunx), and the decisions worth carrying from it are recorded in [`docs/REFERENCE-LRI-MUN-X.md`](docs/REFERENCE-LRI-MUN-X.md).

---

## The five invariants

These are the things that decay silently, so each has a mechanism rather than a convention.

| | Invariant | What holds it up |
| --- | --- | --- |
| 1 | Every API failure is `{ error, code, details? }` | `src/server/errors.ts`, enforced by `withApi` and `tests/api.contract.test.ts` |
| 2 | No module outside `src/server/db.ts` touches the raw client | `no-restricted-imports` on `unsafeDb`, plus a raw-SQL ban |
| 3 | Authorization lives in the service layer, not the route handler | Services take `ctx` and never see a `Request` |
| 4 | No arbitrary colour values in Tailwind | Stage 3 adds the CI grep |
| 5 | Tests skip with a printed reason when Postgres is unreachable | `tests/setup.ts`, which also *fails* rather than skips when `CI` is set |

## Getting started

```bash
cp .env.example .env      # fill in the Supabase values
npm install
mun-pg start              # local Postgres 17, see below
npm run db:migrate
npm run dev
```

`npm test` is green with no database at all. It says so, and says why.

### Local Postgres

`prisma migrate dev` runs against a local Postgres and nothing else. It needs a shadow database and generates `DROP` statements from whatever drift it finds, so pointing it at a shared Supabase project is how you lose a table. Migrations reach Supabase through `npm run db:deploy:remote`, which runs `migrate deploy` — forward-only.

On this machine Postgres 17.9 is installed rootless under `~/.local/pgsql`, with data in `~/.local/pgdata/mun-ops`:

```bash
mun-pg start | stop | status | log
```

WSL runs no init system, so the cluster does not come back after a reboot. `npm run dev` checks and tells you.

## Deploying

Vercel runs `vercel-build`, which is `prisma migrate deploy && prisma generate && next build`. Migrations therefore run *before* the build, so a bad migration fails the deploy instead of shipping a build that cannot query.

Environment variables to set on the Vercel project, for all three environments:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supavisor **transaction** pooler, port 6543, with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supavisor **session** pooler, port 5432 |
| `NEXT_PUBLIC_SUPABASE_URL` | Project root only, no `/rest/v1` path |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never prefixed `NEXT_PUBLIC_` |

Supabase's true direct host, `db.<ref>.supabase.co:5432`, is IPv6-only. The session pooler is the correct `DIRECT_URL` from an IPv4 network, not a compromise.

## Layout

```
prisma/schema.prisma      one schema, one Postgres, no multiSchema
prisma.config.ts          connection URLs live here in Prisma 7, not in the schema
src/server/db.ts          the only module allowed to hold a raw client
src/server/models.ts      every model classified as tenant / org / global
src/server/ctx.ts         createCtx() — the only way to get a database handle
src/server/api.ts         withApi() — parse, validate, service, serialise
src/app/api/**/route.ts   ten-line adapters
tests/                    skips loudly without a database, fails loudly in CI
```

## How tenancy is enforced

Three layers, because one is not enough.

**A Prisma client extension.** `ctx.db` is a client whose `$allOperations` hook injects the tenant filter into every read, write, count and aggregate. Chosen over a repository layer for its failure mode: a repository is bypassed by anyone who types `unsafeDb.committee` and nothing catches it, while the extension is bypassed only by raw SQL and nested relation writes, both of which are greppable and both of which are lint errors.

**A model coverage test.** The extension protects the models it knows about. `tests/models.coverage.test.ts` reads the generated client's model registry and fails until every model is classified in `src/server/models.ts`, which is what protects the models nobody has written yet. Adding a table without deciding how it is scoped breaks CI rather than production.

**Deny-all row level security.** Supabase exposes PostgREST over every table in `public` to anyone holding the publishable anon key, and that key ships in the browser bundle. Every table has RLS enabled with no policies at all, and `anon`/`authenticated` are revoked. The role Prisma connects as has `BYPASSRLS`, which is asserted by a test rather than assumed — had it come back false, every query in the product would return zero rows.

A table added by a later migration does **not** inherit any of this. Measured against the project: a new table arrives granted to `postgres` and `service_role` only, so the grant side is safe by default, but it arrives with RLS **off**, which is wide open rather than closed. Postgres will not fix that for us, because an event trigger on `CREATE TABLE` needs a superuser and our role is not one. So `tests/security.rls.test.ts` is the mechanism: every migration that adds a table repeats the `ENABLE ROW LEVEL SECURITY` block, and the test fails until it does.

RLS is deliberately *not* the tenancy mechanism. Under a transaction-mode pooler `SET LOCAL` only holds inside an explicit transaction, which would mean wrapping every query in one plus a policy on every table in every migration — a lot of machinery to protect a system whose only client is code we wrote.

## Notes on the stack

**Prisma 7** removed `url` from the datasource block and no longer exposes `Prisma.dmmf` at runtime. Connection URLs are in `prisma.config.ts`; the runtime client is handed a `pg` driver adapter, which also means no Rust query engine binary in the serverless bundle. The coverage test reads `Prisma.ModelName` instead of DMMF — public, generated and typed, which DMMF never was.

**npm's `allowScripts` gate.** The approvals are committed in `package.json` with pinned versions. Without them a clean install — which is what CI and Vercel do every time — produces a tree that cannot generate a Prisma client. Bumping Prisma re-blocks the scripts until the approval is renewed.

## Commit style

Sentence-form, imperative, capitalised, no trailing period, no conventional-commit prefixes. Describe the user-visible effect or the reason, not the files touched.

```
Stop a sleeping API being reported as "you are offline"
Make signing out actually end the session
```
