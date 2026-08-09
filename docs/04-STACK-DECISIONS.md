# Stack decisions

Where the original build specification no longer works, and what replaced it.

**The specification was written against Prisma 6, Tailwind 3 and Next 15.** Several of its code
snippets do not compile against what is installed. Every divergence below was verified empirically
before being committed to — none is a guess.

> **Where the specification and the repository disagree, the repository is correct.**
> A session that "fixes" the code back to match the spec will break the build.

Installed versions live in `package.json`. The ones that matter: Next 16.3, React 19.2, Prisma 7.9,
Tailwind 4.3, Zod 4.1, Vitest 4.1.

---

## Prisma 7

### `url` is gone from the datasource block

The spec shows:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")     // rejected outright in Prisma 7
  directUrl = env("DIRECT_URL")
}
```

Connection URLs moved to `prisma.config.ts`, and the runtime client takes a **driver adapter**
instead of an embedded engine:

```ts
// prisma.config.ts — the CLI reads DIRECT_URL for migrations
datasource: { url: env('DIRECT_URL'), ...(shadow ? { shadowDatabaseUrl: shadow } : {}) }

// src/server/db.ts — the runtime takes the pooled URL
new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max }) })
```

Side benefit: no Rust query engine binary in the serverless bundle.

**`shadowDatabaseUrl` must be conditional, not `env()`.** Only `migrate dev` needs one, and only a
developer has one. Declaring it required made the whole config fail to load in CI — and would have
failed the Vercel build identically.

### `Prisma.dmmf` no longer exists at runtime

The spec's headline test reads DMMF. Prisma 7 exposes it as a *type* only. The coverage test reads
**`Prisma.ModelName`** instead — public, generated and typed, which DMMF never was. Same guarantee,
better source.

### Prisma no longer loads `.env`

`prisma.config.ts` begins with `import 'dotenv/config'`.

### One-to-one relations need a field-level unique

`Assignment.delegateId` carries `@unique` rather than relying on
`@@unique([conferenceId, delegateId])`. Prisma requires the field-level form to back a one-to-one,
and here the two are equivalent — a delegate belongs to one conference and never moves.

---

## Tailwind 4

**Decision made explicitly by the user.** CSS-first: there is no `tailwind.config.ts`; colours are
declared in an `@theme` block in `src/styles/tokens.css`.

**Channel triplets are dropped, not ported.** The predecessor publishes
`--rgb-primary: 180 24 132` so translucency can be written as `rgb(var(--rgb-primary) / 0.42)`
without shifting hue. Tailwind 4 compiles the opacity modifier to `color-mix(in oklab, …)`, which
solves the same problem natively. One fewer parallel set of values to keep in agreement.

**Token names are unchanged**, and that is the point — `bg-accent`, `text-ink-secondary`,
`border-edge-strong` are exactly what the predecessor's feature folders already use, so those
screens port with no colour edits. See `05-DESIGN-SYSTEM.md`.

Named durations have no namespace in Tailwind 4, so `duration-micro` / `duration-standard` /
`duration-overlay` are declared with `@utility` to keep the class names identical.

---

## Next 16

### `middleware.ts` → `proxy.ts`

The convention was renamed and the old one warns at build time. The file is `src/proxy.ts` and the
export is `proxy`. Its job is unchanged: refresh the Supabase cookie, import no Prisma, decide
nothing.

It calls `supabase.auth.getClaims()` rather than `getUser()` — the former verifies locally against
JWKS and only calls Supabase when the token has actually expired.

### Typed routes are on

`typedRoutes: true` in `next.config.ts`. This is worth keeping: it caught two nav items pointing at
pages that did not exist, and an **open redirect** where `?next=` reached `redirect()` unvalidated.

Two consequences:

- **`npm run typecheck` runs `next typegen` first.** A bare `tsc --noEmit` fails on a clean checkout
  because the route manifest has not been generated.
- **Do not annotate a path builder as `Route`.** Typed routes describe a path as a template literal
  type, and widening it throws that away. `src/components/layout/navigation.ts` leaves the return
  type to inference for this reason.

`redirect()` and `Link` only accept routes that exist — so a link to an unbuilt page is a compile
error, not a discovery.

### `revalidateTag` takes two arguments

`revalidateTag(tag, { expire: 0 })`. A profile or lifetime is now required.

---

## Zod 4

**`.prefault()`, not `.default()`, for a nested object whose fields have their own defaults.**
A `default` value is handed back as-is without being parsed, so `.default({})` produced a theme seed
with no colours in it and every derived token came out `undefined`. `.prefault({})` feeds the value
through the schema.

`z.email()` and `z.url()` are top-level, not `z.string().email()`.

---

## Deliberate departures that are not version-forced

**Supabase Auth with email + password and Google**, not magic links. Chosen by the user. Supabase
still owns the credential — there is no password column. The sign-in is two-step (address, then
password or sign-up), which is an account-enumeration oracle accepted deliberately for the UX and
rate limited hard.

**`aws4fetch`, not `@aws-sdk/client-s3`.** ~80 KB against ~15 MB. Carried from the predecessor,
which documents this as the single most likely dependency to be reached for unthinkingly.

**Upstash Redis, not an in-process rate limiter.** The predecessor uses `express-rate-limit`, whose
store is per-instance — on a platform running many instances the effective ceiling is the limit
times however many are warm. Its own notes concede it is "friction rather than a hard cap".

**`@tanstack/react-query` defaults carried verbatim**, including `networkMode: 'always'` on
mutations and the retry predicate. Deleted with the move to cookies: the `localStorage` token store,
`refreshTokens`, the single-in-flight-refresh promise and the 401-retry dance.
