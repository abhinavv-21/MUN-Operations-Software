# Testing

What the suite guards, and the conventions that keep it honest.

```bash
npm test                              # everything
npx vitest run tests/allocations.test.ts   # one file
npx vitest run -t "oversubscribe"     # one test by name
npx vitest run --reporter=verbose     # confirm tests ran rather than skipped
```

---

## The harness contract

`tests/setup.ts` probes Postgres with a timeout before anything imports the app, and:

- **On a laptop with no database, it skips and prints why.** This is what kept the predecessor's
  suite honest across 53 commits — a suite that fails for environmental reasons gets ignored, then
  deleted.
- **In CI it exits 1 instead.** A skipped integration suite in CI is a green build that tested
  nothing.
- The reason is written to `process.stderr` directly. `console.warn` is buffered per test file and
  discarded for a file whose tests all skipped, so the notice would vanish exactly when it matters.

`describeWithDb` from `tests/support/harness.ts` is `describe` when a database is reachable and
`describe.skip` when it is not. Pure-logic suites use plain `describe` and run anywhere.

`resetDatabase()` deletes in dependency order rather than relying on cascades — a missing
`onDelete` then shows up as a failing teardown instead of a mystery later.

**`isolate: true` is not negotiable.** See trap 11 in `07-TRAPS.md`: turning it off let one file's
`vi.mock` reach another, and five tests passed for a reason nobody wrote.

---

## What each suite guards

| File | Guards |
| --- | --- |
| `models.coverage.test.ts` | Every model is classified. The highest-value test in the repo, and the only one that gets *more* valuable over time — it protects tables nobody has written yet. No database needed. |
| `tenancy.scoping.test.ts` | Cross-tenant reads return nothing; cross-tenant updates are 404; scoping survives `$transaction`; `create` injects the key; `upsert` refuses. |
| `security.rls.test.ts` | Every table has RLS on, no policies exist, and the connecting role has `BYPASSRLS`. |
| `api.contract.test.ts` | The error contract: shape, 422 details, 400-not-422 for bad JSON, `EXPOSE_ERROR_DETAILS` failing closed, auth defaulting to required. |
| `membership.test.ts` | 404-not-403 for a stranger, byte-identical to a slug that never existed; invitation tokens stored only as hashes; last-owner protection; audit rows. |
| `conferences.test.ts` | A conference id from another organisation is 404 on read **and** write; plan limits with `details.limit`; per-conference committee uniqueness. |
| `public-registration.test.ts` | Identical responses for new and repeat submissions; the honeypot writing nothing and running before validation; the platform-vouched IP; payment-proof URL pinning. |
| `review.test.ts` | Approving creates a delegate and **allocates nothing**; only PENDING is reviewable; a rejected applicant may reapply; one person may be a delegate at two conferences. |
| `ingestion.test.ts` | A real Google Forms export; `Committee`/`Country` reported and ignored; the webhook 401ing when repointed; idempotency by email. |
| `allocations.test.ts` | The concurrency guarantees, the matrix parser in both shapes, and the write-conflict detection across four error shapes. |
| `theme.test.ts` | Six seeds including a pale yellow and mid-grey-on-mid-grey; every ground pair clears its ratio; token names present. |
| `ui.test.ts` | `cn` keeps a text colour beside a named text size. |
| `client-env.test.ts` | Browser env values are read as literal expressions. Reads the *source*, because nothing at runtime can catch it server-side. |

---

## Conventions

**Prove a security fix by reverting it.** A test that passes after a fix has not demonstrated it
catches anything. Put the bug back, watch the suite go red, restore. Traps 1 and 8 were both
confirmed this way, and the confirmation is what makes the claim worth writing in a commit message.

**Name the guarantee, not the function.** `answers 404, not 403, to a stranger asking about an
organisation` says what breaks if it fails. `resolveMembership returns null` does not.

**Comment the *why* in the test.** These read as a specification of the product's promises. Where a
test encodes a decision — why 403 would be a leak, why importing must not allocate — the reasoning
belongs in the test, because that is where someone will find it when tempted to change the
behaviour.

**Assert the absence too.** `expect(await db.delegate.count()).toBe(0)` after an import is the point
of the test; the row count that *did* change is the easy half.

**Fixtures are prefixed `zz_`** so a half-finished run is obvious in the database and cheap to
sweep.

**Identity is the only thing stubbed.** `vi.mock` on `../src/server/auth/session.ts` replaces the
signed-in claims; everything else runs for real — `withApi`, `createCtx`, JIT provisioning,
membership resolution, the scoped client and Postgres. Route handlers are called directly:

```ts
const { POST } = await import('../src/app/api/orgs/route.ts')
const response = await POST(request, { params: Promise.resolve({ orgSlug: 'zz-alpha' }) })
```

Faster than supertest and covers the same chain.

---

## Adding a suite

1. Pure logic → plain `describe`, no database, runs anywhere.
2. Anything touching Postgres → `describeWithDb`, with `resetDatabase()` in `beforeEach`.
3. Anything needing a signed-in user → the `vi.mock` above, and a claims constant per persona.
4. If it guards a security property, revert the fix once and confirm it fails.
