# Architecture

How a request becomes a scoped query, and why it cannot escape.

---

## Tenancy, in three layers

One layer is not enough. Each covers what the others miss.

### Layer one — the scoping extension

`src/server/db.ts` exports `scope({ organizationId?, conferenceId? })`, a Prisma client extension
whose `$allOperations` hook injects the tenant filter into every read, write, count and aggregate.

Chosen over a repository layer for its **failure mode**, not its ergonomics. A repository layer is
bypassed by anyone who types `unsafeDb.committee` and nothing catches it. The extension is bypassed
only by raw SQL and nested relation writes — and both are greppable, and both are ESLint errors.

Specific behaviours worth knowing before you change it:

- **`findUnique` is rewritten to `findFirst`.** A unique lookup plus a non-unique filter is no
  longer a unique lookup, and Prisma rejects the argument shape. The tempting fix — drop the tenant
  filter for unique lookups — *is* the leak.
- **`upsert` throws.** Scoping it safely means rewriting it into find-then-branch, which is a
  different set of races than the caller asked for. Refusing is honest.
- **An unhandled operation throws** rather than passing through unscoped.
- **A scoped model queried with no scope throws.** Returning every tenant's rows is precisely the
  bug the module exists to prevent, so it fails loudly.

Two known holes, both deliberate and both documented in the file: `$queryRaw` bypasses it entirely,
and nested relation writes do not get the key injected into the nested model. Prefer explicit
top-level creates inside `runSerializable`.

### Layer two — classification coverage

`src/server/models.ts` classifies every model. `tests/models.coverage.test.ts` fails until a new one
is classified. See invariant 6.

### Layer three — deny-all RLS

Every table has row level security enabled with **no policies at all**, and `anon` /`authenticated`
revoked. The connecting role has `BYPASSRLS`, so the application is unaffected.

RLS is deliberately **not** the tenancy mechanism. Under a transaction-mode pooler
`SET LOCAL app.current_conference` only holds inside an explicit transaction, so every query would
need wrapping in one, plus a non-`BYPASSRLS` role and a policy on every table in every migration.
That is a great deal of machinery to protect a system whose only client is code you wrote. It is
here to close the PostgREST hole, which has nothing to do with our code at all.

---

## Three scope axes

| Axis | Models | Scoped by |
| --- | --- | --- |
| **Tenant** | `Committee`, `CommitteeCountry`, `ConferenceRole`, `Registration`, `Delegate`, `Assignment`, `ConferenceIntegration`, `AttendanceRecord`, `LogisticsRequest`, `Award` | `conferenceId` |
| **Organisation** | `Membership`, `Conference`, `Invitation`, `AuditLog` | `organizationId` |
| **Global** | `Organization`, `User` | nothing — each needs a reason |

`Organization` is global because resolving one is how a request discovers its tenant; scoping it by
itself is circular. `User` is global because identity spans organisations.

`Conference` is organisation-scoped rather than tenant-scoped because it *is* the conference
boundary.

`AuditLog` is the one table carrying both ids: an organisation-level action — inviting a member,
transferring ownership — has no conference to be filed under, so `conferenceId` is nullable and
`organizationId` is not.

### `ORG_REACHABLE_MODELS`

`ConferenceRole` alone may be **read** with only an organisation in scope, filtered through its
`conference` relation. This exists for exactly one question — "what can this user reach in this
organisation" — which the conference switcher asks on every page and which has no single conference
to scope to.

Deliberately narrow, in two ways. **Reads only**: a write still needs a conference. **Membership
tables only**: `Committee` is not in it and must not be, because an organiser with a grant on MUN XI
and none on MUN X should not be able to read MUN X's operational data.

### `ORG_REVOCABLE_MODELS`

One model and one operation: `deleteMany` on `ConferenceRole`, filtered through the same
`{ conference: { organizationId } }` clause.

It exists for one action — removing somebody from the organisation — which is inherently
organisation-wide, because a person leaving takes their grants on every conference with them. It is
a separate list rather than a widening of the one above precisely so the narrowness is visible:
nothing here can create or update across conferences, only revoke.

Added in Stage 7, after the success path of `removeMember` was found to have answered 500 since
Stage 2. See `07-TRAPS.md` #14.

---

## Scope resolution — the reads that discover a scope

`src/server/scope-resolution.ts` holds the complete list of unscoped reads in the product. Five
functions, and the file is short enough to read in full during review.

They exist because of a chicken-and-egg: you cannot scope a query by the organisation when the point
of the query is to work out which organisation you are in. `resolveMembership` cannot use `ctx.db`,
because `ctx.db` is built from its answer.

| Function | Keyed by |
| --- | --- |
| `findMembershipForUser` | user id + slug — worst case returns a row about the caller |
| `listMembershipsForUser` | user id |
| `findPublicConference` | org slug + conference slug; filters out `DRAFT`/`ARCHIVED` here so the caller cannot forget |
| `findInvitationByTokenHash` | the hash of a secret |
| `emailHasAccount` | **nothing** — an enumeration oracle by construction, accepted deliberately for the two-step sign-in, rate limited at its route, returns a boolean |

The alternative was relaxing the extension so services could do this themselves. Keeping it in one
allowlisted module means the list is finite and auditable. **Adding a sixth function here should
feel like a decision.**

---

## Request shape

```
src/server/ctx.ts          createCtx() → { user, membership, db, audit, conferenceRole }
src/server/services/*.ts   pure functions taking ctx; no Request, no Response
src/app/api/**/route.ts    ten-line adapters: parse → validate → service → serialise
src/server/page-ctx.ts     the same context for Server Components
```

`createCtx` is the only supported way to get a database handle.

`withApi(handler, options)` exists since Stage 1, before there was a second route — without a single
wrapper every route re-implements authentication slightly differently and the difference is
invisible until one of them is wrong.

```ts
withApi<Params>(handler, {
  auth: 'required' | 'optional' | 'none',   // default 'required' — fails closed
  orgParam: 'orgSlug',                      // resolves membership; non-member → 404
  conferenceParam: 'conferenceId',          // resolves conference role; wrong org → 404
  audit: 'committee.create',                // warns in development if no audit row was written
})
```

`auth` has three states, not two, because "public" means two different things: the invitation
preview needs to know who you are *if* you are signed in (`'optional'`), while the health check has
no use for identity at all and must work where there is no cookie store (`'none'`).

---

## Effective roles

Two levels, coarse over fine:

```
org OWNER or ADMIN  →  conference ADMIN, on every conference in the org
org MEMBER          →  whatever ConferenceRole says, or nothing
```

`MEMBER` alone grants nothing; it is a container for conference grants. The motivating case is real:
the logistics head for MUN XI should have CONTRIBUTOR on XI and **nothing** on MUN X, which is
finished and whose data should now be frozen.

**`resolveConferenceRole` checks that the conference belongs to the organisation *before* the
org-admin shortcut.** Getting that order wrong was a cross-tenant hole — see `07-TRAPS.md`.

`canManageMembers` is deliberately off the role axis and re-read from the database on every request
that depends on it. Running the conference and deciding who may sign in are different powers.

---

## The bootstrap pattern

Creating an organisation must write `Organization`, `Membership` and `AuditLog` — but the latter two
are organisation-scoped, and the organisation does not exist yet.

The answer is to **generate the id first**, with `uuidv7()` from `src/server/ids.ts`, so the scope
exists before the first write and all three rows go through one already-scoped client in one
transaction. `Organization` is a global model and passes straight through.

The alternative — create the organisation, then switch clients — puts the membership in a second
transaction, and a failure there leaves an organisation nobody can reach, including the person who
just made it, with no screen in the product able to repair it.

---

## Shared machinery

**`runSerializable(db, work, attempts)`** — `src/server/transaction.ts`. Seat capacity is a
read-then-write; two organisers allocating the last seat both read "14 of 15" and both write. The
unique constraint is the guarantee; this turns the race into a clean 409 rather than a crash. It
detects write conflicts through the code, the SQLSTATE, the driver adapter's message and one level
of nested `cause` — see `07-TRAPS.md` for why all four are needed.

**`recordAudit(db, params)`** — `src/server/audit.ts`. The `client` parameter is not decoration: an
audit row for a write that rolled back is worse than none, so pass the transaction client. A
redaction list replaces sensitive keys at any depth before anything is stored.

**The offline queue** — `src/lib/offline/`. `policy.ts` is pure and holds the rule (two writes, and
which failures retry rather than drop); `queue.ts` is the Dexie store and the flush loop. Nothing
outside the attendance and logistics screens may import `sendOrQueue`, and a test greps for that.
Both queueable writes are idempotent on the server, which is the property that makes them queueable
at all — not their importance.

**The exporters** — `src/server/exporters/`. `table.ts` is the one shape every writer takes; `csv`,
`xlsx` and `pdf` are hand-written with no runtime dependency beyond `node:zlib`, because `pdfkit`
and `exceljs` both break a serverless bundle in ways that only appear in production. Dataset
assembly lives in `src/server/services/exports.ts`, so authorization runs for a Server Component
too.

**`assertWithinLimit(org, limit, current)`** — `src/server/limits.ts`. One funnel at the top of
every create path. **403, not 402** — a 402 with no payment mechanism is a lie. The UI keys on
`details.limit`, not on the status code.

**`scopedCreate<T, K>(data)`** — `src/server/db.ts`. The extension injects the scope column at
runtime; Prisma's generated input types do not know that. This reconciles the two views in one
place, keeping every other field type-checked.
