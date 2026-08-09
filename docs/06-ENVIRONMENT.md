# Environment and operations

Setup, configuration, deployment, and what to run when something looks wrong.

**No credential appears in this file.** Variable names and sources only. Real values live in `.env`
and `.env.supabase` (both gitignored) and in the Vercel project.

---

## This machine

WSL2 Ubuntu. Two things are unusual and both were forced by the same constraint: **`sudo` does not
work from an agent session** — there is no TTY to authenticate against, from either an agent's own
shell or the user's `!` prefix. So everything is installed rootless into `~/.local`.

**Node 24** via nvm, symlinked into `~/.local/bin` so the Linux binaries beat the Windows
`node.exe` at `/mnt/c/Program Files/nodejs` on PATH. Wired into both `~/.bashrc` and `~/.profile` —
Ubuntu's `.bashrc` returns early for non-interactive shells, so one alone is not enough.

**PostgreSQL 17.9**, unpacked from the PGDG `.deb` files into `~/.local/pgsql` with `dpkg-deb -x`,
each binary wrapped in `~/.local/bin` with the right `LD_LIBRARY_PATH`. Full toolset — `psql`,
`pg_dump`, `pg_restore`.

```bash
mun-pg start | stop | status | log
```

Data lives in `~/.local/pgdata/mun-ops`; databases `mun_ops_dev`, `mun_ops_test`, `mun_ops_shadow`.
**WSL runs no init system, so the cluster does not survive a reboot.** `npm run dev` checks and
tells you.

**The repository is at `~/projects/mun-ops`, not on `D:`.** Measured with 400 small files, the
Windows mount was ~5× slower on writes and **~158× slower on reads** (2999 ms against 19 ms). Next
dev, Vitest and `tsc` are almost entirely small-file reads. From Windows the same tree is
`\\wsl$\Ubuntu\home\abhinav\projects\mun-ops`.

---

## Environment variables

`.env` is read by **both** Next.js and the Prisma CLI — one file, because two holding the same
`DATABASE_URL` drift, and the failure looks like a migration that ran against the wrong database.
`.env.example` is the committed template.

| Variable | Used for | Where the value comes from |
| --- | --- | --- |
| `DATABASE_URL` | runtime queries | local Postgres in dev; Supavisor **transaction** pooler (`:6543`, `?pgbouncer=true&connection_limit=1`) in production |
| `DIRECT_URL` | migrations | local Postgres in dev; Supavisor **session** pooler (`:5432`) in production |
| `SHADOW_DATABASE_URL` | `migrate dev` only | local `mun_ops_shadow`. **Must not be set in CI or on Vercel** |
| `TEST_DATABASE_URL` | the test suite | local `mun_ops_test` |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server auth | Supabase → Settings → API. **Project root only, no path** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server auth | Supabase → API keys → publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Supabase → API keys → secret. Never prefixed `NEXT_PUBLIC_` |
| `UPSTASH_REDIS_REST_URL` | public rate limiting | Upstash console → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | public rate limiting | Upstash console → REST API |
| `S3_ENDPOINT` | payment-proof uploads | Backblaze bucket endpoint, with `https://` |
| `S3_REGION` | payment-proof uploads | the middle segment of that endpoint |
| `S3_BUCKET` | payment-proof uploads | the bucket **name**, not its id |
| `S3_ACCESS_KEY_ID` | payment-proof uploads | B2 application key → keyID |
| `S3_SECRET_ACCESS_KEY` | payment-proof uploads | B2 application key → applicationKey, shown once |
| `EXPOSE_ERROR_DETAILS` | 5xx bodies | optional; fails closed, so unset is safe |

**The port difference is load-bearing.** `:6543` is transaction mode for the runtime; `:5432` is
session mode, which `migrate deploy` needs because it takes an advisory lock transaction mode cannot
hold across statements. Supabase's true direct host is IPv6-only, so the session pooler is the
correct `DIRECT_URL`, not a compromise.

**All five `S3_*` blank is a supported state**, not a broken one: the upload endpoint answers 503,
the public form says payment proof is unavailable, and registration still works.

**Rate limiting silently disables itself** if the Upstash pair is absent. That is deliberate — a
limiter that takes the public form down during a third party's incident is worse — but it means a
missing variable looks like nothing at all.

---

## Third-party configuration already applied

Recorded because none of it is visible in the repository.

**Supabase** — Google provider enabled; `site_url` set to the production origin; redirect allowlist
covers `/auth/callback` on production and localhost. Email confirmation is **on**
(`mailer_autoconfirm: false`). Postgres 17.6. The pooler role is not superuser but does have
`BYPASSRLS`, which the whole RLS design rests on and which a test asserts.

Changing provider settings needs a **Personal Access Token** (`sbp_…`) against
`api.supabase.com/v1/projects/{ref}/config/auth` — the service-role key is rejected. Create one at
supabase.com/dashboard/account/tokens and revoke it immediately after.

**Google Cloud** — OAuth web client; authorised redirect URI is Supabase's
`/auth/v1/callback`, *not* ours. Google redirects to Supabase; Supabase redirects to us.

**Vercel** — function region **`sin1`**, matching the Supabase project in `ap-southeast-1`. This
took warm health-check latency from 1069 ms to **4 ms**. Region is pinned at build time, so
changing it needs a redeploy.

**Backblaze B2** — bucket is **private**. Verified: `PUT` 200, anonymous `GET` 401, signed `GET` 200.

---

## Deployment

Vercel runs `vercel-build`:

```
prisma migrate deploy && prisma generate && next build
```

Migrations run **before** the build, so a bad migration fails the deploy rather than shipping a
build that cannot query.

Environment variables are **inlined at build time**. Changing one requires a redeploy — and editing
a variable's value is not the same as redeploying, which is worth remembering when a fix appears not
to take.

---

## Runbook

```bash
# start the local database after a reboot
mun-pg start

# author a migration (local only — never against Supabase)
npm run db:migrate

# apply committed migrations to Supabase
npm run db:deploy:remote

# rebuild both local databases from scratch
dropdb -h 127.0.0.1 -U postgres mun_ops_dev && createdb -h 127.0.0.1 -U postgres mun_ops_dev
npx prisma migrate deploy
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:5432/mun_ops_test" npx prisma migrate deploy
npx prisma generate

# everything CI runs
npm run typecheck && npm run lint && npm test && npm run build
```

**`prisma migrate dev` runs against local Postgres and nothing else.** It needs a shadow database
and generates `DROP` statements from whatever drift it finds. Pointing it at a shared Supabase
project is how you lose a table.

### Checks worth knowing

```bash
# is production healthy, with a real database round trip
curl -s https://munopshub.vercel.app/api/health

# did a deployment actually inline its public env vars
curl -s https://munopshub.vercel.app/sign-in \
  | grep -oE '/_next/static/[a-zA-Z0-9_./-]+\.js' | sort -u \
  | while read c; do curl -s "https://munopshub.vercel.app$c" | grep -o 'sb_publishable_[A-Za-z0-9_-]*'; done

# is RLS still closed to the browser-facing key
curl -s -H "apikey: $ANON" "$SUPABASE_URL/rest/v1/Delegate?select=*" # expect 42501 permission denied

# which providers are enabled (public endpoint, no token needed)
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON"
```

Vercel serves static chunks from `/_next/static/immutable/chunks/`, not `/_next/static/chunks/` —
scraping the wrong path once produced a confident false negative.

---

## Renaming the hosted project

The product is **Bloc**. The repository and the Vercel project still carry the old working title,
because renaming either needs credentials that are not on this machine — and because the Vercel half
has a consequence worth doing deliberately rather than in passing.

**GitHub.** Settings → General → Repository name → `Bloc`. GitHub keeps a permanent redirect from
the old path, so existing clones and the `origin` remote keep working; update the remote anyway:

```bash
git remote set-url origin https://github.com/abhinavv-21/Bloc.git
```

**Vercel, and the part that bites.** Renaming the project changes the production URL from
`munopshub.vercel.app` to `<new-name>.vercel.app`. Two things break the moment it does, and both
break silently:

1. **Every registration link already given out.** `/r/<org>/<conference>` is printed on posters and
   pasted into school newsletters. Vercel does not redirect the old subdomain.
2. **Sign-in, completely.** Supabase's `site_url` and its redirect allowlist both name the old
   origin. OAuth comes back to an address that is no longer allowed and the callback reports the
   link as expired — which is trap 10 wearing a different hat, and it looks like an auth bug rather
   than a rename.

So do it in this order, or not at all:

1. Add the new name as a **domain** on the existing Vercel project first, so both resolve.
2. Update Supabase → Authentication → URL Configuration: `site_url`, and add the new
   `/auth/callback` to the allowlist. Leave the old one in place.
3. Redeploy. Environment variables are inlined at build time, so a rename with no redeploy leaves
   the old origin in the bundle.
4. Verify sign-in on the new origin **before** removing the old domain.
5. Only then rename the project and drop the old domain.

The alternative, and the better one once there is a first paying organiser: buy a domain and point
it at the project. Then the Vercel project name stops being anybody's address and this problem never
recurs.

---

## Known stale references

- **`prisma/seed.ts`** was listed in the ESLint allowlist but never created. Removed; recreate the
  entry alongside the file if a seed is added.
- `docs/README.md` previously pointed at a `KICKSTART-MUN-SAAS.md` that does not exist in this
  repository. Replaced by this documentation set.
