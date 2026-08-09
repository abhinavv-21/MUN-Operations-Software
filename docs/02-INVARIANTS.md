# Invariants

Eight rules. Each has a **mechanism** that enforces it and a **command** that proves it.

They are listed with mechanisms because a rule with no mechanism is a preference, and preferences
decay. Five came from the original specification. Three were added during the build, each after a
defect that the original five did not catch.

---

## 1. The error contract

**Every API failure is `{ error: string, code: number, details?: unknown }`.** `details` is omitted
entirely when undefined, never serialised as `null`. No exceptions, no bare
`NextResponse.json({ message })`.

*Mechanism:* `ApiError` and its statics in `src/server/errors.ts` are the only way to fail.
`withApi` catches everything and serialises through `toApiError`, which tries a deliberate
`ApiError`, then `translatePrismaError`, then a 500 that never leaks a message it did not choose.

*Proof:* `npx vitest run tests/api.contract.test.ts`

Two rules inside this one that are easy to lose:
- **422 for validation**, with `details: [{ path, message }]`. The client unpacks exactly this
  shape into operator-facing text.
- **404, not 403, for "exists but is not yours".** A 403 confirms the resource exists.

---

## 2. The tenancy rule

**No module outside `src/server/db.ts` may import the raw Prisma client.** All data access goes
through `ctx.db`, already scoped.

*Mechanism:* the client is exported as `unsafeDb`; an ESLint `no-restricted-imports` rule blocks
it everywhere except an explicit allowlist, and `no-restricted-syntax` blocks `$queryRaw` and
`$executeRaw` alongside it, because raw SQL bypasses the scoping extension entirely.

*The complete allowlist* (in `eslint.config.mjs`): `src/server/db.ts`, `src/server/ctx.ts`,
`src/server/scope-resolution.ts`, `src/app/api/health/route.ts`, `tests/**`.

*Proof:* `npm run lint`. To see it fire, write `import { unsafeDb } from '@/server/db.ts'` into any
service.

---

## 3. Authorization lives in the service layer

**Not in the route handler.** Server Components call services directly, so a check that lives only
in a Route Handler is a check that does not run for the first paint.

*Mechanism:* services take `ctx` and return values; they never see a `Request` or a `Response`.
Route handlers are ten-line adapters. `pageCtx` gives Server Components the same context and
translates the same failures into `notFound()` and `redirect()`.

*Proof:* the members page calls `requireMemberManager` itself rather than trusting that the API
would have. Grep for `requireMemberManager` — it appears in both the service and the page.

---

## 4. No arbitrary colour values

**No `bg-[#...]`, no hex, no `rgb()` in `.tsx`.** Semantic token names only.

*Mechanism:* `scripts/check-no-arbitrary-colors.mjs`, wired into `npm run lint`. It scans
`src/app` and `src/components` for arbitrary Tailwind colours, hex literals and colour functions.
Colour is defined in `src/styles/tokens.css` and `src/lib/theme/` and nowhere else.

*Proof:* `npm run check:colors`. Plant a `bg-[#fff]` to watch it fail — it names the file, line and
reason.

*The one exemption:* `public/google.svg` holds Google's four brand colours, as a static file rather
than inline JSX, precisely because a colour that cannot be themed does not belong in the token
system.

---

## 5. Tests skip with a printed reason when Postgres is unreachable

**`npm test` is green on a laptop with no database**, and says why it skipped.

*Mechanism:* `tests/setup.ts` probes with a timeout and writes the reason to `process.stderr`
directly — `console.warn` is buffered per file and discarded for a file whose tests all skipped.
**When `CI` is set it exits 1 instead**, because a skipped integration suite in CI is a green build
that tested nothing.

*Proof:*
```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/nope" npx vitest run
CI=1 TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/nope" npx vitest run  # exits 1
```

---

## 6. Every model is classified — *added during the build*

**Every Prisma model appears in exactly one of `TENANT_MODELS`, `ORG_MODELS` or `GLOBAL_MODELS`**
in `src/server/models.ts`.

The scoping extension protects the models it knows about. This protects the models nobody has
written yet: a table added in six months would otherwise be unscoped, silently, forever.

*Mechanism:* `tests/models.coverage.test.ts` reads `Prisma.ModelName` from the generated client and
fails until every model is classified — and fails again if a classified model no longer exists.

*Proof:* `npx vitest run tests/models.coverage.test.ts`. Add a model to the schema without
classifying it.

---

## 7. Every migration that adds a table enables RLS — *added during the build*

**Supabase serves PostgREST over every table in `public` to anyone holding the publishable anon
key**, and that key ships in the browser bundle. A new table arrives with row level security *off*,
which is wide open rather than closed.

Postgres will not fix this automatically: an event trigger on `CREATE TABLE` needs a superuser, and
the migration role is not one. **Measured against the real project:** a new table inherits grants
for `postgres` and `service_role` only — so the grant side is safe — but arrives with RLS off.

*Mechanism:* every migration that creates a table repeats this idempotent block:

```sql
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename); END LOOP;
END $$;
```

`tests/security.rls.test.ts` fails until it is there, and also asserts the connecting role has
`BYPASSRLS` — if that ever became false, every query in the product would return zero rows.

*Proof:* `npx vitest run tests/security.rls.test.ts`

---

## 8. Browser environment variables are read as literal expressions — *added during the build*

**Never `process.env[name]` for a `NEXT_PUBLIC_` value.**

Next.js inlines browser environment variables by textually replacing exactly
`process.env.NEXT_PUBLIC_FOO`. A computed read cannot be replaced, so the value is `undefined` in
the browser while working perfectly on the server. This broke every sign-in button with no error
message, and typecheck, lint, the full suite and the build all passed — because they all run on
the server.

*Mechanism:* `src/lib/supabase/config.ts` reads the two public values into module constants at the
top, and validates them: trimmed, and rejected with a message naming the variable if the value
contains a newline or looks like a whole `NAME=value` assignment.

*Proof:* `npx vitest run tests/client-env.test.ts` — it reads the source, because no runtime
assertion can catch this from the server side.

To check a deployment really inlined them:
```bash
curl -s https://munopshub.vercel.app/sign-in \
  | grep -oE '/_next/static/[a-zA-Z0-9_./-]+\.js' | sort -u \
  | while read c; do curl -s "https://munopshub.vercel.app$c" | grep -o 'sb_publishable_[A-Za-z0-9_-]*'; done
```

---

## Running all of it

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

That is exactly what CI runs, in that order, on every push.
