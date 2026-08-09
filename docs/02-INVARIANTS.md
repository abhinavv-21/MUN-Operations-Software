# Invariants

Eleven rules. Each has a **mechanism** that enforces it and a **command** that proves it.

They are listed with mechanisms because a rule with no mechanism is a preference, and preferences
decay. Five came from the original specification. Three were added during Stages 1–6, each after a
defect the original five did not catch; two in Stage 7 — one after a route was found never to have
written its audit row, one because the offline rule is a product decision a comment cannot hold; and
one in Stage 8, after a content security policy passed every server-side check while leaving three
pages painted and dead.

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

The second rule is about *other tenants*, and Stage 7 made the boundary explicit.
`requireConferenceAdmin` answers **403**, because reaching it means the conference is already inside
the caller's own organisation — its existence is not a secret from them, and what they lack is the
rank. Hiding an organisation's own chain of command from its own members is not the thing the rule
protects.

---

## 2. The tenancy rule

**No module outside `src/server/db.ts` may import the raw Prisma client.** All data access goes
through `ctx.db`, already scoped.

*Mechanism:* the client is exported as `unsafeDb`; an ESLint `no-restricted-imports` rule blocks
it everywhere except an explicit allowlist, and `no-restricted-syntax` blocks `$queryRaw` and
`$executeRaw` alongside it, because raw SQL bypasses the scoping extension entirely.

*The complete allowlist* (in `eslint.config.mjs`): `src/server/db.ts`, `src/server/ctx.ts`,
`src/server/scope-resolution.ts`, `src/app/api/health/route.ts`, `tests/**`.

*One narrow exception inside the extension itself*, added in Stage 7: `ORG_REVOCABLE_MODELS`.
`deleteMany` on `ConferenceRole` may run with only an organisation in scope, filtered through
`{ conference: { organizationId } }`, because removing somebody from an organisation has to take
their grants on every conference in it. Deletion only, membership tables only, still bounded to one
tenant. It exists because the alternative was a route that answered 500 — see `07-TRAPS.md` #14.

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

## 9. Every mutating admin route writes an audit row — *added in Stage 7*

**A route that changes something inside an organisation leaves a trace of who changed it.**

*Mechanism:* three layers, because none of them holds alone.

1. `tests/audit.manifest.test.ts` walks every `route.ts` under `src/app/api`, finds each exported
   `POST`/`PUT`/`PATCH`/`DELETE`, and requires every one that resolves an organisation to declare an
   `audit:` action. A route that is genuinely not an admin route has to be listed in
   `NON_ADMIN_ROUTES` **with a written reason**.
2. `withApi` **throws under Vitest** when a route declares an audit action, succeeds, and wrote no
   row. A declaration is a comment until something checks it.
3. The live sweep in the same file calls every mutating admin route once against a real database, so
   layer 2 has the chance to fire on all of them rather than on whichever happen to be covered
   elsewhere. A fourth test fails if a route exists that the sweep never calls.

*Proof:* `npx vitest run tests/audit.manifest.test.ts`. Each layer was confirmed by breaking it
alone: delete an `audit:` option (layer 1 fails), delete the `ctx.audit.record` call from a service
(layer 2 fails, naming the route and the expected action), add a new mutating admin route (layer 3
fails, naming the file).

---

## 10. The offline queue holds exactly two writes — *added in Stage 7*

**A logistics request and an attendance check-in. Everything else fails fast.**

Not a technical limit. Both of those are append-only from the operator's side and idempotent on the
server — attendance by its natural key `(conference, delegate, day)`, logistics by a
browser-minted `clientRequestId`. Nothing without that property may be queued, because queueing an
edit queues a conflict that cannot be resolved later without a merge dialog nobody will understand.

*Mechanism:* `src/lib/offline/policy.ts` holds the list and the reasoning.
`tests/offline.policy.test.ts` asserts the list is exactly those two, asserts both idempotency
mechanisms exist in the schema and services, and greps the source to assert only the attendance and
logistics screens import `sendOrQueue`. `networkMode: 'always'` in `src/app/providers.tsx` is the
other half: it stops React Query pausing everything else into a promise that never settles.

*Proof:* `npx vitest run tests/offline.policy.test.ts` for the policy, and
`node scripts/e2e-offline.mjs` for the browser half — a real headless Chrome with
`Network.emulateNetworkConditions { offline: true }`, which is the command the devtools Offline
checkbox sends. Comment out `networkMode: 'always'`, rebuild, and the check-in hangs instead of
queueing.

---

## 11. The content security policy is verified in a browser — *added in Stage 8*

**A CSP is invisible to every check that runs on the server.** Typecheck, lint, the whole suite and
the production build all pass with a policy that blocks the application's own bootstrap, because
none of them is a browser. That is the same family as invariant 8.

The policy itself: a **per-request nonce** with `'strict-dynamic'`, no `'unsafe-inline'` for scripts,
and `style-src-elem` nonced with `'unsafe-inline'` confined to `style-src-attr` — React writes style
attributes for the meters and a nonce cannot cover an attribute.

*Mechanism:* `src/lib/csp.ts` builds it, `src/proxy.ts` sets it on the request as well as the
response — that is how Next finds the nonce — and `scripts/csp-check.mjs` loads every page type in a
real headless Chrome, listens for `securitypolicyviolation`, and **asks whether React hydrated**. A
blocked bootstrap renders the server HTML perfectly and responds to nothing, so "the page looks
right" proves nothing at all.

**A nonce forces dynamic rendering.** Nothing in the product is statically prerendered any more, and
that is the accepted cost — measured, not assumed: the marketing pages still score 100 for
performance.

*Proof:*
```bash
npm run build && node scripts/csp-check.mjs
# and, for a page that needs a fixture:
CSP_EXTRA_PATHS=/r/your-org/your-conference node scripts/csp-check.mjs
```

---

## Running all of it

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

That is exactly what CI runs, in that order, on every push.

Two things are deliberately outside it, because both need something a laptop or a CI runner may not
have:

```bash
npm run build && node scripts/e2e-offline.mjs   # invariant 10, in a real browser
npm run build && node scripts/csp-check.mjs     # invariant 11, in a real browser
```

See `08-TESTING.md`.
