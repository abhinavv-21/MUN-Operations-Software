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
| `audit.manifest.test.ts` | Invariant 9, in three layers: every mutating admin route declares an audit action, `withApi` throws under Vitest when a declared one is not written, and a live sweep calls every such route so layer 2 fires on all of them. A fourth test fails if a route exists the sweep never calls. |
| `attendance.test.ts` | Check-in is idempotent by `(conference, delegate, day)` — the property the offline queue rests on — a replay is audited as unchanged, six concurrent marks make one row and no 500, and a delegate from another conference is 404. |
| `logistics.test.ts` | A replayed `clientRequestId` returns the original row with the original 201; two requests with no token stay two; resolving requires a note; reopening clears the closure. |
| `awards.test.ts` | A delegate must sit in the committee giving the award; several delegates may share a verbal mention; a CONTRIBUTOR gets 403 to write and 200 to read. |
| `exporters.test.ts` | CSV formula injection is neutralised for every prefix a spreadsheet executes; the XLSX is unzipped and read back; the PDF's cross-reference offsets are walked against their objects; `Content-Disposition` cannot inject a header. |
| `offline.policy.test.ts` | Exactly two writes may be queued, both idempotency mechanisms exist, and only two screens import `sendOrQueue`. |

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

## The one thing that is not in `npm test`

`scripts/e2e-offline.mjs` drives a real headless Chrome over the DevTools Protocol and is run by
hand:

```bash
npm run build && node scripts/e2e-offline.mjs
```

It is out of the suite deliberately. It needs a browser and a live round trip to Supabase, and
invariant 5 says `npm test` stays green on a laptop with neither. What it proves cannot be proved
any other way — `Network.emulateNetworkConditions { offline: true }` is the command the devtools
Offline checkbox sends, and the guarantee is about what the *browser* does.

It uses no dependency: Node's built-in `WebSocket` talks to Chrome directly. It signs in through the
product's own sign-in form rather than forging a session cookie, opens three tabs — the register,
the logistics board and the delegate list, as they sit on three devices at a real conference — and
reads results straight out of Postgres with `psql`, because asking the application whether it saved
something is asking the wrong witness.

On this machine Chrome needs `libnss3`, `libnspr4` and `libasound2` unpacked rootless into
`~/.local/chromium-deps`, the same pattern `06-ENVIRONMENT.md` describes for Postgres. The script
adds that to `LD_LIBRARY_PATH` itself.

---

## Adding a suite

1. Pure logic → plain `describe`, no database, runs anywhere.
2. Anything touching Postgres → `describeWithDb`, with `resetDatabase()` in `beforeEach`.
3. Anything needing a signed-in user → the `vi.mock` above, and a claims constant per persona.
4. If it guards a security property, revert the fix once and confirm it fails.
