# LRI MUN X — reference for the next build

This is not a tour of the codebase.
It is a record of the decisions inside it, written so that a session with no memory of building it can look up an answer instead of re-deriving it.

Repository: <https://github.com/abhinavv-21/lrimunx>

Read this when you are about to write something that this project has already written.
The error contract, the audit trail, the allocation race, the way a public endpoint must answer — all of it cost real time to get right, and all of it is portable.

**One warning before anything else.**
This is a **single-tenant** application.
It serves exactly one conference, accounts are created by hand, and there is no signup page anywhere by design.
Its auth and hosting decisions were made under constraints that do not apply to a multi-tenant SaaS, and several of them are actively wrong to copy.
Those are marked **DO NOT CARRY** throughout.

---

## 1. The shape

Three npm workspaces in one repository, plus Prisma at the root.

| Workspace | What it is | Stack |
| --- | --- | --- |
| `apps/website` | The public conference site and the two-step registration form | Vite + vanilla JS + GSAP + Lenis |
| `apps/frontend` | The OC operations hub, served under `/admin` | React 18 + Vite SPA + Tailwind + TanStack Query |
| `apps/backend` | The API behind both, at `/api/v1` | Express 4 + TypeScript + Prisma + zod |

`prisma/` sits at the repository root, not inside the backend, because the seed script and the deploy scripts both need it.

### Three entry points, one app

`apps/backend/src/app.ts` exports `createApp(): Express`.
Nothing else constructs the application.
Three things consume it:

- `apps/backend/src/index.ts` — the long-lived server.
Eager `prisma.$connect()` that exits with a readable message if Postgres is unreachable, `listen()`, and SIGINT/SIGTERM graceful shutdown.
This is what Render runs.
- `apps/backend/src/serverless.ts` — the Vercel entry.
`createApp()` and nothing else: **no `listen()`, no `process.exit`, no eager `$connect()`**.
The platform owns the socket, a function that kills its own process takes in-flight requests down with it, and a cold start wants a lazy connection.
- `createApp()` called directly by the test suite, with no port bound.

`api/index.ts` at the repository root is two lines: it imports `../apps/backend/dist/serverless.js` and re-exports it.
It imports the **compiled** output, not the TypeScript source, because the backend is an ESM package whose internal imports carry explicit `.js` extensions.
Handing that to Vercel's bundler as source is asking it to resolve a module graph written for `tsc`.
Building first is one extra step and removes the whole class of problem.

`api/package.json` exists only to mark that directory as `"type": "module"`, and `api/` is deliberately **not** an npm workspace.

---

## 2. Contracts worth copying verbatim

These are pure modules.
Their value is the reasoning already encoded in them, and they port to any framework unchanged.

### The error contract — `apps/backend/src/lib/errors.ts`

Every failure, everywhere, is:

```ts
interface ApiErrorBody { error: string; code: number; details?: unknown }
```

`details` is omitted entirely when undefined.
`class ApiError` carries `code` and `details` and exposes statics: `badRequest` (400), `unauthorized` (401), `forbidden` (403), `notFound` (404), `conflict` (409), `unprocessable` (422), `internal` (500).

There are no exceptions to this shape.
The frontend's `errorMessage()` helper depends on it, and so does every test.

### The Prisma error ladder — `apps/backend/src/middleware/errorHandler.ts`

A known Prisma error is translated rather than leaked:

| Prisma code | Becomes | Note |
| --- | --- | --- |
| `P2002` unique violation | **409** | With specific messages for `committeeId+country` and `delegateId` |
| `P2003` FK violation | **400** | |
| `P2025` record not found | **404** | |
| `PrismaClientValidationError` | **400** | |

Body-parser errors are handled too: `entity.too.large` becomes **413**, `entity.parse.failed` **400**.

Stacks are logged only for `code >= 500` that are not deliberate `ApiError`s, and are attached to the response body **only** when `EXPOSE_ERROR_DETAILS` is on.
The flag fails closed.

### Validation — `apps/backend/src/middleware/validate.ts`

`validate(schema, source = 'body')` where source is `'body' | 'query' | 'params'`.

Two things about it matter:

1. It returns **422**, not 400, with `details: [{ path, message }]` where `path` is `issue.path.join('.')` or `'(root)'`.
The frontend unpacks exactly this into operator-facing text.
2. On success it **replaces** `req[source]` with the *parsed* value.
Downstream handlers therefore receive coerced, trimmed, stripped data — never the raw input.
This is what makes it safe to read `req.body.email` without re-checking it.

### Serializable allocation — `apps/backend/src/lib/transaction.ts`

```ts
runSerializable<T>(work, attempts = 3)
```

A Prisma `$transaction` at `Serializable` isolation with a 10-second timeout.
It retries **only** `P2034` (write conflict / deadlock), with `25 * attempt` ms of backoff.
Anything else propagates immediately.

This exists because seat capacity is a read-then-write.
Two admins allocating the last seat in UNSC at the same moment will both read "14 of 15 filled" and both write, without it.
The database-level `@@unique([committeeId, country])` catches the country collision; the transaction catches the capacity one.
You need both.

### Audit logging — `apps/backend/src/lib/audit.ts`

`recordAudit(params, client = prisma)` and `auditRequest(req, params, client = prisma)`.
Rows carry `payloadBefore` and `payloadAfter` as JSON.

The `client` parameter is not decoration.
Assignment audits are written **inside the same transaction** as the assignment, so an audit row cannot exist for a write that rolled back.

A private redaction list replaces these keys with `'[redacted]'` before anything is stored: `passwordHash`, `password`, `token`, `refreshToken`, `keysAuth`, `keysP256`.
Dates are serialised to ISO strings.

`apps/backend/src/middleware/auditGuard.ts` is the enforcement.
On `res.on('finish')`, in development only, it console-warns when a 2xx admin mutation left `req.auditWritten` unset.
It never fails a response — it just makes the omission impossible to miss while you are working.

### Sessions — `apps/backend/src/lib/sessions.ts`

**DO NOT CARRY** the mechanism. Do carry the reasoning.

Refresh tokens used to be purely stateless, so signing out cleared the browser and nothing else: a token copied from a shared school machine kept minting access tokens for a week, and there was no way to stop it — not by signing out, not by changing the password.

The fix stores a `Session` row keyed by the **SHA-256 of the refresh token**, never the token itself, so the table cannot be read back into a working credential.
`rotateSession` spends the presented token and issues a new one in a single `$transaction`.

It is deliberately **not** reuse-detection.
Detecting a replayed token and nuking the whole family is the textbook answer and it is wrong for a conference: a delegate on flaky venue wifi retries a request, and you have just signed the secretariat out mid-allocation.

Refresh tokens carry a `jti` so two sign-ins in the same second do not collide on `tokenHash`.

Known gap: `sweepExpiredSessions()` is written and nothing calls it.
There is no scheduled cleanup.

### Storage — `apps/backend/src/lib/storage.ts`

S3-compatible presigned URLs against a **private** bucket.

Signed with **`aws4fetch` (~80 KB), not `@aws-sdk/client-s3` (~15 MB)**.
This is the single most likely thing to be reached for unthinkingly, and the size difference decides whether the API fits inside a serverless bundle limit at all.

- Path-style URLs: `<endpoint>/<bucket>/<key>`
- Prefix `payment-proofs/`, keys generated with `crypto` and unguessable
- Presigned PUT expires in 30 minutes, presigned GET in 10
- `isStorageUrl(value)` requires `https:` and pins the accepted URL to the configured bucket **and prefix**, so an arbitrary URL cannot be stored in `paymentProofUrl` and later clicked by an admin from the review queue

One correction that a test caught, worth repeating because it was written into three files before being disproved: with `signQuery: true`, aws4fetch signs **only the `host` header**.
The content type is *not* part of the signature.
What actually bounds the endpoint is elsewhere — the key is chosen server-side and unguessable, the declared type and size are validated before anything is signed, the request is rate limited, and the bucket is private.

All five `S3_*` variables blank is a **supported state**, not a broken one: the upload endpoint answers 503, the form says so, and registration still works without a screenshot.

---

## 3. Security decisions that look like bugs until you know why

Every one of these has been mistaken for a defect at least once.

**The public registration endpoint always returns the same body.**
`POST /api/v1/public/register` answers `201 { status: 'received', reference }` whether it created a row or found a live application for that email already.
Created and duplicate are indistinguishable from outside.
If they were not, the endpoint would be an oracle for "has this person registered for LRI MUN X" against any email address you care to try.

**The honeypot returns success.**
`honeypotGate` runs *before* validation, sleeps `8 + randomInt(0, 6)` ms, and answers 201 with a **fabricated** reference.
A bot that gets an error learns to fix its submission.
One that gets a plausible reference learns nothing.

**Login compares against a dummy hash when the account does not exist.**
`bcrypt.compare(password, '$2a$12$invalid...')` costs the same as a real comparison, so response timing does not reveal whether a username exists.
The 401 message is identical either way.

**`requireUserManager` hits the database on every request.**
Everywhere else `req.user` comes from token claims and is never re-read — role changes therefore take up to fifteen minutes to bite.
For account management that was unacceptable: a revoked permission that keeps working for fifteen minutes defeats the point of revoking it.
So that one gate pays for one extra query per request.
See `apps/backend/src/middleware/rbac.ts`.

**Rate limiters are keyed on `x-vercel-forwarded-for`, not `x-forwarded-for`.**
The first is set by the platform and cannot be forged by the caller.
The second can be, which makes it useless as a rate-limit key.
`TRUST_PROXY` is clamped to 0–5 for the same reason — set too high, a caller can spoof their own address.

**Managing accounts is a boolean flag, not a role.**
`User.canManageUsers` is deliberately off the role axis.
Running the conference and deciding who can sign in are different powers.
Adding an `OWNER` role above `ADMIN` would have meant auditing every `role === ADMIN` check in the codebase, and an owner who silently lost the rest of their admin powers is a worse bug than the one being fixed.

---

## 4. The guarantees

Things the system promises, and the mechanism that makes each true.

**A public registration can never become an account.**
`Registration` and `User` are unrelated tables.
Approval creates a `Delegate`.
Nothing in any code path creates a `User` from public input, and there is no signup route.
This is covered by an integration test named after the guarantee.

**Two delegates cannot hold the same country.**
`@@unique([committeeId, country])` on `Assignment`, plus `runSerializable` around every allocation.
The constraint is the guarantee; the transaction is what turns a race into a clean 409 instead of a crash.

**A committee with no matrix is unconstrained.**
Zero rows in `CommitteeCountry` for a committee means free-text countries are accepted for it.
This is what allowed one committee's matrix to be imported without freezing the other five, and it is enforced in `applyAssignment`, not just hidden in the UI.

**Importing never allocates.**
Committee and country columns in an uploaded CSV or a Google Form are parsed, **ignored, and reported back** as ignored.
A form answer is a wish; an allocation is a decision the secretariat makes.
Silently honouring a delegate's stated preference as a placement would be the worst kind of helpful.

**`Registration.email` is deliberately not unique.**
A rejected applicant may legitimately reapply, and a school secretary submits for two students from one inbox.
The rule that matters — one *live* application per address — is a `PENDING`/`APPROVED` lookup in the route, not a database constraint.

---

## 5. Known gaps — do not inherit these

Stated plainly because they are easy to copy by accident.

- **`npm run lint` cannot run.**
The root script is `eslint apps --ext .ts,.tsx` with ESLint 8 and the `@typescript-eslint` plugins installed, but **there is no ESLint config file anywhere in the repository**.
- **`.env.example` is stale.**
It still documents the Vercel Blob variables and contains **none** of the five `S3_*` variables the code actually reads.
`render.yaml` has the correct set; `SCHOOL-SERVER.md` §4 is the doc that reflects reality.
- **There is no CI.**
`.github/workflows/keep-alive.yml` is a daily pinger and nothing else.
No workflow runs typecheck, tests or lint on a push.
- **The country matrix is enforced in one place only.**
`applyAssignment` in `apps/backend/src/routes/delegates.routes.ts` checks it.
`POST /assignments` and `PATCH /assignments/:id` check seat capacity but **not** the matrix.
- **`sweepExpiredSessions()` is never called.**
- **`DEPLOYMENT.md` §3 describes Vercel Blob**, which was replaced by S3-compatible storage in commit `8a1bd03`.

---

## 6. Frontend patterns that earned their place

**Feature-domain folders, not type folders.**
`src/features/delegates/`, `/logistics/`, `/registrations/` — thirteen of them, each holding its page plus the components only that page uses.
No barrel files; imports are direct through the `@/` alias.

**TanStack Query is the only state manager.**
No Redux, no Zustand, no Jotai.
Everything else is local `useState` inside a feature page, plus three React contexts (auth, offline, toast).

Query keys are flat arrays whose first segment is the domain: `['delegates', filters]`, `['committees', id]`, `['registrations', 'stats']`.
Invalidation fan-out is documented in one file (`apps/frontend/src/lib/hooks.ts`) — a delegate write invalidates `delegates`, `dashboard`, `committees`, `attendance` **and** `matrix`, because a delegate carries an allocation and an allocation changes four other screens.

**`networkMode: 'always'` on mutations.**
React Query's default is to *pause* mutations when it thinks you are offline.
On venue wifi that left inline-save controls stuck on "Saving" forever, with no error and no way out.
Failing fast and showing the error is better than a spinner that never resolves.

**`placeholderData: keepPreviousData` on every filtered list.**
Typing in a search box otherwise blanks the table on every keystroke.

**One in-flight refresh promise.**
`refreshInFlight ??= …` in `apps/frontend/src/lib/api.ts`, so six concurrent 401s trigger exactly one refresh call rather than six.

**`code: 0` is split into two messages.**
A network throw becomes `ApiError` with code 0, and the message branches on `navigator.onLine`:

> You appear to be offline. The request was not sent.

versus

> The server did not respond. It may be starting up after being idle — wait a few seconds and try again.

This exists because a sleeping free-tier API answers with a CORS-less 502 while it wakes, and `fetch` throws for that in a way indistinguishable from having no connection.
Telling a signed-in user on good wifi that they are offline is a lie that sends them to reset their router.

**`warmApi()`** fires a no-op `GET /health` when the sign-in screen mounts, so the instance is waking while the password is being typed.

**The offline queue holds exactly two writes.**
`apps/frontend/src/lib/offline.ts` queues `POST /logistics-requests` and `POST /attendance/check-in` in Dexie.
Everything else fails fast **on purpose**.
Queueing a delegate edit means queueing a conflict you cannot resolve later without showing the user a merge dialog they will not understand.

**No component library and no CVA.**
Radix primitives for behaviour (dialog, alert-dialog, dropdown, tooltip, toast, slot), Lucide for icons, and variants are plain `Record<Variant, string>` maps.

---

## 7. The two design systems, and why theming has to change

There are two, they are deliberately not shared, and only one of them can be themed.

### The ops hub — `DESIGN.md` + `apps/frontend/tailwind.config.ts`

Colours are **literal hex in Tailwind's `theme.extend`**.
There are **zero** CSS custom properties in the entire hub.
No `darkMode` strategy, no `.dark` class, no `data-theme`, no `prefers-color-scheme` handling, and `color-scheme: light` is hard-set on `:root`.

Tailwind bakes those values into class rules at build time, so **a runtime theme swap is impossible without a rebuild.**

### The public site — `apps/website/src/styles/tokens.css`

The same problem, already solved, in the same repository.

- ~90 CSS custom properties on `:root`
- **Channel triplets** — `--rgb-primary: 180 24 132` — so translucency works as `rgb(var(--rgb-primary) / 0.42)` without introducing a new hue
- **Four ground classes** — `.ground-ink`, `.ground-paper`, `.ground-blush`, `.ground-magenta` — each republishing the same seven locals: `--ground`, `--on-ground`, `--on-ground-muted`, `--hairline`, `--focus-ring`, `--accent-on-ground`, `--border-interactive`

Sections read those locals, never a literal.
That is the whole trick: a hardcoded `--color-text-primary` on a plum ground is 1.02:1, and the ground class is what makes it impossible to write.

### The migration is config-only

Every hub component already uses semantic class names — `bg-accent`, `text-ink-secondary`, `border-edge`.
A grep for `text-[#` across `apps/frontend/src` returns **nothing**.
The only arbitrary values in the whole hub are `[3px]` for the magenta rule, three panel widths, and a `calc()` for the safe-area inset.

So converting to swappable themes means editing `tailwind.config.ts` and nothing else: replace each hex with `rgb(var(--rgb-token) / <alpha-value>)` and keep every token name identical.
**The token names are the migration contract.**

Four things still need hand-fixing: `apps/frontend/index.html`'s `<meta name="theme-color">`, the two `theme('colors.…')` calls in `src/styles/index.css`, one `theme(colors.accent.DEFAULT)` in `DataTable.tsx`, and the rgba literals in the config's `boxShadow`.

### One thing the next project must do differently

The contrast contract in `tokens.css` is a **hand-maintained table in a comment** — eleven measured pairs with pass marks.
That works for one brand.
The moment an organiser picks their own navy, that comment is worthless and every ratio in it is a guess.
Contrast has to become a function with a test, not a comment.

---

## 8. Operational lessons

Each of these cost a deploy or an afternoon.

**Render's `fromService: { property: host }` returns the *internal* service name.**
`https://$API_HOST/api/v1` resolved to `https://lrimunx-api/api/v1`, which is `ENOTFOUND` from any browser.
Both bundles built green, deployed green, and were completely non-functional for every real visitor.
The API was perfectly healthy — the address was wrong, so pinging the API would not have caught it either.

The fix is in `scripts/compose-static.mjs`: `assertReachableApiBase()` walks the composed `dist/`, regex-scans every `.js`/`.css`/`.html`/`.webmanifest` for an API base, and **fails the build** if the host is `localhost`, `127.0.0.1`, or contains no dot.
It checks the **artifact**, not the environment variable, because the variable being set is not the same as the right value reaching the bundle.

**Vite bakes `VITE_*` at build time.**
Changing the API base means redeploying the *site*, not the API.
Anything `VITE_`-prefixed is public by definition and must never hold a secret.

**A CORS `Origin` is scheme + host + port.**
No trailing slash, no path.
This cost time twice, so `apps/backend/src/app.ts` now strips trailing slashes from every configured origin rather than requiring the operator to get it exactly right.

**Free tiers sleep, on two different clocks.**
Render sleeps a web service after 15 idle minutes.
Supabase pauses a project after 7 days of low **database** activity and eventually deletes it.
Those need different pingers: an uptime monitor on a 5-minute clock for the first, and a daily job that actually touches Postgres for the second.
An endpoint that returns a version string without querying the database will keep a monitor green while the project pauses underneath it.

**npm 12 blocks dependency install scripts** unless listed in `allowScripts`.
Prisma needs its query engine and esbuild needs its platform binary.
Locally you will not notice, because an older `node_modules` already has them; a clean install — which is exactly what a CI build is — produces a tree that cannot generate a client or run Vite.

**`npm install --include=dev` is required on the host.**
Under `NODE_ENV=production` npm omits devDependencies, and `tsc` and Vite are devDependencies.
The failure is `tsc: command not found` partway through a build.

---

## 9. Testing

Vitest, 152 `it()` blocks — 105 unit and 47 integration — driven with `supertest` against the in-process app with no port bound.
Run with `npm test`.

Two things about the harness are worth carrying over exactly.

**It skips with a printed reason when Postgres is unreachable.**
`apps/backend/src/test-support/harness.ts` probes `SELECT 1` with a 5-second timeout and, on failure, skips the entire integration suite *with a message saying why*.
`npm test` therefore stays green on a laptop with no database.
This is what kept the suite honest across 53 commits — a suite that fails for environmental reasons gets ignored, and then it gets deleted.

It also re-checks the four required environment variables **by hand before importing the app**, because `config/env.ts` calls `process.exit(1)` on a bad config and that would kill the test runner with no explanation.

**Fixtures are namespaced and swept.**
Everything a test creates is prefixed `zz_`, and the suite asserts a before/after census of every table.
It runs against a real database and must leave it exactly as it found it.

---

## 10. Environment contract

`apps/backend/src/config/env.ts` validates `process.env` with zod at startup and calls `process.exit(1)` with per-field messages on failure.
The API refuses to start rather than run half-configured.

Required, no default: `DATABASE_URL`, `JWT_SECRET` (≥32 chars, rejected if it matches `/^replace-me/i`), `JWT_REFRESH_SECRET` (same), `GOOGLE_SHEETS_WEBHOOK_SECRET` (≥16).

Defaulted: `NODE_ENV`, `PORT` 4000, `TRUST_PROXY` 0 (clamped 0–5), `CORS_ORIGIN`, `JWT_ACCESS_TTL` `15m`, `JWT_REFRESH_TTL` `7d`, `EXPOSE_ERROR_DETAILS` false, the VAPID trio, the five `S3_*`, `DANGER_RESET_PASSPHRASE` (empty disables the feature entirely).

Two derived flags rather than variables: `pushEnabled` and `s3UploadsEnabled`.
A feature whose configuration is absent turns itself off and says so, instead of failing at the moment a user reaches for it.

---

## 11. Commit style

Sentence-form, imperative, capitalised, no trailing period, and **no conventional-commit prefixes**.
They describe the user-visible effect or the reason, not the files touched.

```
Fix what the site looks like on a phone
Stop a sleeping API being reported as "you are offline"
Keep the free tiers awake, with the right tool for each clock
Drop plan: free from the static site — Render rejects it
Make signing out actually end the session
Stop the thank-you thanking people for a screenshot that never arrived
```

Match this in the new repository.
It reads as a changelog without anyone having to write one.
