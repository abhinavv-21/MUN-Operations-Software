# Traps

Every defect found during the build, and the lesson from each.

This is the decision record. The pattern throughout: **the reasoning ported perfectly and the
mechanism did not**, because a library changed underneath it. Copying the predecessor's code without
re-verifying its assumptions is the single most reliable way to reintroduce these.

---

## Security

### 1. An org admin could reach any organisation's conference

**Symptom:** none. Every Stage 2 test passed.

**Cause:** `resolveConferenceRole` took the org-admin shortcut *before* checking which organisation
the conference belonged to.

```ts
if (isOrgAdmin(membership.orgRole)) return 'ADMIN'   // any conferenceId at all
```

An owner of organisation A who pasted B's conference id into the URL was handed ADMIN on it. The
scoped client then filtered operational rows by that `conferenceId` and returned them — because
`conferenceId` is the *only* filter those tables carry. Any organisation admin could read any other
organisation's committees, and later delegates and allocations, by guessing one id.

**Fix:** the ownership check runs first. **Proven by reverting it:** reading returned 200 and
writing returned 201 without the fix; both are 404 with it.

**Lesson:** it survived Stage 2's suite because every test there was about *organisation*
membership, and the guarantee that broke was about *conference* ownership. A guarantee with no test
naming it is not guarded — being adjacent to something well tested counts for nothing.

### 2. The health check answered 401 in production

**Symptom:** the live deployment reported itself down while it was up.

**Cause:** making `auth` default to required in Stage 2 applied it to `/api/health`, which an uptime
monitor reaches with no cookies.

**Fix:** the default is right and stays — a route that declares nothing should be one nobody reaches
anonymously. What was missing is that "public" means two things: the invitation preview wants to
know who you are *if* you are signed in, while the health check has no use for identity at all.
`auth` became `'required' | 'optional' | 'none'`.

**Lesson:** a default that fails closed is correct, and every existing route needs re-examining when
you introduce one.

### 3. An unvalidated `?next=` reached `redirect()`

**Symptom:** none. Caught by **typed routes** refusing to accept an arbitrary string.

**Cause:** an open redirect — `/sign-in?next=https://evil.example` would send someone through a
genuine sign-in and out to an attacker's page. The phishing variant that is hard to spot precisely
because the sign-in was real.

**Fix:** `src/lib/safe-redirect.ts`, used by both the sign-in page and the auth callback. It rejects
`//evil.example` too — that starts with a slash but a browser reads it as protocol-relative.

**Lesson:** typed routes earn their keep. Keep them on.

---

## Correctness

### 4. Every write conflict became a 500

**Symptom:** the capacity race test failed with `DriverAdapterError: TransactionWriteConflict`
surfacing as unhandled 500s.

**Cause:** `runSerializable` retried only on `P2034`, which is what Prisma reports through its own
query engine. Through a **driver adapter** — how Prisma 7 talks to Postgres here — the same failure
arrives as a `DriverAdapterError` wrapped in a `PrismaClientKnownRequestError`. The retry never
fired.

Two organisers allocating at the same moment would each have seen the product break, rather than one
of them seeing "someone got there first".

**Fix:** detection covers the code, the SQLSTATE (`40001`), the adapter's message and one level of
nested `cause`, with jittered backoff so callers that collide once do not wake together and collide
again. Exhausting the retries answers **409, not 500**.

**Lesson:** the reasoning ported perfectly; the error shape did not. When porting error handling
across a driver change, verify the shape rather than the intent.

### 5. `tailwind-merge` silently deleted text colours

**Symptom:** found by reading rendered HTML, not source. The primary button carried
`bg-accent … text-body` and no `text-ink-inverted`.

**Cause:** our font sizes are *named*, not numeric. tailwind-merge assumes any `text-<x>` is a colour
unless it knows `<x>` is a size, so it read `text-body` as a colour, decided it conflicted, and kept
the last one. Every primary button rendered with default dark text on the accent fill — the exact
contrast failure the whole derivation exists to prevent, discarded before it reached the DOM.

**Fix:** `extendTailwindMerge` registering the named `font-size`, `rounded` and `shadow` scales.
`tests/ui.test.ts` guards it.

**Lesson:** a class merger can drop the wrong class and the page still renders, looking almost
right. Read the rendered output, not just the source.

### 6. `surface` collapsed into `canvas`

**Symptom:** cards had no visible edge against the page.

**Cause:** `surface` was clamped to a lightness *floor* rather than stepped from `paper`. A
near-white paper produced a surface identical to the canvas.

**Fix:** always a step above, never merely "at least this light".

### 7. Zod `.default({})` produced an empty seed

**Symptom:** every derived theme token came out `undefined`.

**Cause:** a Zod default value is handed back as-is without being parsed, so `.default({})` on the
seed object skipped the four field defaults inside it.

**Fix:** `.prefault({})`, which feeds the value through the schema.

---

## Silent failure

### 8. Browser environment variables were never inlined

**Symptom:** both sign-in buttons span forever with no error. Identical for Google and email.

**Cause:** `config.ts` read the public values through a **computed key** — `process.env[name]`
inside a helper. Next inlines them by textually replacing exactly `process.env.NEXT_PUBLIC_FOO`; a
computed read cannot be replaced. Both values were `undefined` in the browser while working
perfectly on the server, so the client factory threw before any `await`.

**Confirmed** by grepping the built client chunks: the project URL was not in them.

**Fix:** module-level constants using the literal form. `tests/client-env.test.ts` reads the
*source*, because no runtime assertion can catch this from the server side — and it was verified by
reintroducing the bug and watching it fail.

**Lesson:** typecheck, lint, 130 tests and the build all passed with this in place, because every
one of them runs on the server. **A whole class of bug is invisible to server-side checks.** When
something works in tests and not in a browser, suspect the boundary itself.

### 9. A thrown error stranded the spinner

**Symptom:** the same perpetual loading, with no message — which is what made trap 8 so hard to see.

**Cause:** none of the auth handlers had a `try/finally`. A throw skipped the line that clears the
busy flag, and the error was swallowed.

This is *precisely* the failure the predecessor documents and that `networkMode: 'always'` exists to
prevent — "inline-save controls stuck on Saving forever, with no error and no way out". The
reasoning was ported into the query client and then the bug was rebuilt by hand in a form.

**Fix:** `setBusy(false)` in a `finally`, every handler surfacing what went wrong.

**Lesson:** porting a *policy* into one layer does not protect the layers you write afterwards.

### 10. Two variables pasted into one Vercel box

**Symptom:** `Failed to execute 'fetch' on 'Window': Invalid value` on email sign-up, and "that link
has expired" on Google.

**Cause:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` held the anon key, a newline, then
`SUPABASE_SERVICE_ROLE_KEY=…` as literal text. A header value cannot contain a newline — hence the
browser-internals error — and the same broken key failed the OAuth token exchange, which the
callback rendered as an expired link.

**Fix:** values are trimmed and rejected with a message naming the variable if they contain a
newline or look like a whole `NAME=value` assignment.

**Lesson:** a misconfiguration should be legible at the first request. Also: **redeploying does not
clean a stored value** — the variable itself has to be edited, which cost a round trip to discover.

### 14. Removing a member answered 500, and every test was green — *Stage 7*

**Symptom:** none, for two stages. Found by the Stage 7 audit sweep, which calls every mutating
admin route.

**Cause:** `removeMember` deletes the person's conference grants after deleting their membership:

```ts
await tx.conferenceRole.deleteMany({ where: { userId: targetUserId } })
```

`ConferenceRole` is org-reachable — readable across an organisation, writable only with a conference
in scope — and this route has no conference. The scoping extension threw, correctly, and `withApi`
turned it into a 500. **Removing anybody from an organisation had never worked.**

The reason nothing caught it is the same shape as trap 1: the only test on `DELETE` asserted the
*refusal* path, `refuses to remove the last owner`, and that path returns from
`assertNotLastOwner` before ever reaching this line. A test named after a guarantee adjacent to the
broken one guards nothing.

**Fix:** `ORG_REVOCABLE_MODELS` in `src/server/models.ts` — one model, one operation. `deleteMany`
on `ConferenceRole` may run with only an organisation in scope, filtered through
`{ conference: { organizationId } }`. Deliberately not a widening of `ORG_REACHABLE_MODELS`:
nothing here can create or update across conferences, only revoke, and the filter still bounds it to
one tenant.

The alternative — leaving grants behind — is a security bug, not untidiness: re-inviting somebody
silently restores access they used to have. Doing it one conference at a time outside the
transaction is worse again, because a failure halfway deletes the membership and keeps the grants.

**Proven by reverting it:** three tests go red, including the sweep, with `500` in place of `200`.

**Lesson:** the sweep found this because it calls *every* mutating admin route rather than the ones
somebody thought to test. Coverage of a route list is a different thing from coverage of behaviour,
and this is the class of bug only the first one finds.

### 15. The E2E harness drove the previous build — *Stage 7*

**Symptom:** a check that should have failed came back green, and one that should have passed timed
out at an unrelated step.

**Cause:** `scripts/e2e-offline.mjs` starts the app with `spawn('npx', ['next', 'start'])` and killed
it with `child.kill()`. `npx` forks `next`, which forks `next-server`; killing the wrapper leaves
`next-server` holding the port. The next run's `waitForServer` got a 200 immediately — from the
**previous build** — and drove that instead.

**Fix:** `detached: true` and `process.kill(-pid)`, plus a guard that refuses to start when something
already answers on the port. A stale server is not a condition to work around silently.

**Lesson:** an end-to-end harness that can silently test the wrong binary is worse than none,
because its green is indistinguishable from a real one. When a revert-the-fix check does not go red,
suspect the harness before the conclusion.

### 16. A nonce-based CSP silently un-hydrated every static page — *Stage 8*

**Symptom:** none that any server-side check could see. `typecheck`, `lint`, 224 tests and `build`
all passed. The pages rendered perfectly and did nothing.

**Cause:** a nonce is per request. A statically prerendered page was generated at build time, before
any request existed, so Next could not stamp the nonce onto its script tags — and the browser then
refused the page's own bootstrap.

The failure was legible only because of *which* pages failed: `/sign-in` and `/invite` passed,
`/`, `/how-it-works` and `/offline` did not. Dynamic versus static, exactly.

**Fix:** the root layout reads `x-nonce` from the request headers, which both supplies the nonce to
the inline theme block and makes every route dynamic. The cost is the CDN cache on two marketing
pages; it was accepted only after measuring Lighthouse at 100 for performance without it.

**Caught by** `scripts/csp-check.mjs`, written before the policy because this is trap 8's family: a
whole class of bug that no server-side check can see. It loads every page type in a real Chrome,
listens for `securitypolicyviolation`, and asks the page whether React actually hydrated — a blocked
bootstrap paints the server HTML perfectly and responds to nothing.

**Two more the same script found**, both after the policy "worked": a third `<style>` call site on
the public registration page that never got the nonce, so applicants would have seen the default
palette rather than the organiser's; and the settings theme preview, which rendered a `<style>`
element on the *client*, where no nonce exists — rewritten as a style attribute, which
`style-src-attr` permits.

**Lesson:** write the check before the control it checks. And when a policy fails on some pages and
not others, read the list of which — it usually names the cause.

### 17. Lighthouse measured a build that no longer existed — *Stage 8*

**Symptom:** a CSP violation that had already been fixed kept appearing in the Lighthouse report,
while `csp-check.mjs` on the same page reported none.

**Cause:** the same leak as trap 15, from the other end. Four `next start` servers from earlier runs
were still holding ports, because `pkill -f "next start -p 3213"` matches the wrapper and not the
`next-server` process that actually listens. Lighthouse connected to whichever one owned the port
and measured a build from twenty minutes earlier.

**The tell was in the report:** the policy it quoted had no `style-src-elem`, which the current build
had. A stale artefact usually says so if you read it closely.

**Fix:** the runner refuses to start when anything already answers on its port, and kills by process
group. Two tools now disagreeing is a signal to check they are looking at the same thing.

**Also from this:** `chrome-launcher` treats WSL as Windows and creates its temp directory from
`LOCALAPPDATA`, which landed a literal `C:\Users\...` **directory inside the repository**. The next
Turbopack build then failed with an unrelated-looking CSS parse error pointing at `globals.css`.
Lighthouse now runs from outside the repository.

### 18. A queued check-in was destroyed after 105 seconds offline — *Stage 9*

**The worst defect this product has had.** Silent, and it shipped.

`classifyAttempt` counted a `code: 0` outcome — *nothing came back* — against
`MAX_ATTEMPTS = 8`, and `run()` deleted the entry on `drop`. The flush poll fires
every fifteen seconds and makes exactly one attempt on the head of the queue, so
eight attempts is a hundred and five seconds. Two minutes without signal in a
basement committee room destroyed every queued check-in and every queued
logistics request — the precise scenario the queue exists for, and the one
written on the landing page. The only trace was `lastDrop`, one dismissable
string naming no delegate.

**Why the Stage 7 proof missed it.** `scripts/e2e-offline.mjs` went offline for a
few *seconds*. Being offline was tested; being offline for a **while** was not.
Duration was the variable and it was never varied.

**Fix:** a request that got no answer is never dropped. `drop` now requires the
server to have actually responded — a 422 is information, silence is not. The
attempt counter still increments, for the age display, but can never reach a
verdict.

**Proven twice by reverting:** the unit test goes red at attempt 7, and the
browser check now stays offline for seventy seconds and asserts both writes
survive.

**Lesson:** "we tested the offline path" is not the same claim as "we tested
being offline for as long as a real outage lasts". When a feature's whole
premise is a duration, the test has to have a duration in it.

### 19. Every ground-vocabulary utility was inert — *Stage 9*

`tokens.css` published the seven ground locals as plain `@theme`:

```css
@theme { --color-hairline: var(--hairline); }
```

Tailwind emits that into `:root`, where `--hairline` does not exist — it is
declared by the `.ground-*` classes further down. A custom property is
substituted at computed-value time **on the element it is declared on**, so it
resolved to the guaranteed-invalid value at the root, and every descendant
inherited the invalid value. Entering a ground later did not repair it.

So `text-on-ground-muted`, `border-hairline`, `text-accent-on-ground` and three
others did nothing, product-wide, for two stages.

**It looked fine**, which is why it survived: a ground class also sets `color` on
itself, so text inside one was already the right colour. What was lost was every
*distinction* — muted text rendered identical to primary text, and a hairline
rendered as a full-strength ink rule.

**Fix:** those seven live in their own `@theme inline` block, which writes the
value into the utility rather than through a `:root` alias.

**Found by two independent designers measuring `getComputedStyle` instead of
trusting the class name** — the same lesson as trap 5, which was also a class
that was present in the source and absent from the render. Read the rendered
output.

### 20. Choosing a theme preset did nothing — *Stage 9*

`themeSchema.parse({ preset: 'forest' })` returned the **magenta** seed.

The four seed fields carried magenta as per-field `.default(...)`, and the object
carried `.prefault({})` — which feeds the value through the schema rather than
handing it back, so parsing always produced four explicit colours. `withPreset`
spreads the seed *over* the preset, so that an override wins; with an explicit
seed always present, a preset could never apply.

Nothing in the product noticed, because the settings form always sends four
explicit colours. An API caller sending `{ "preset": "navy" }`, or a row edited
by hand, silently got magenta.

**Fix:** the seeds are optional, and `withPreset` fills each absent one from the
preset field by field — a spread cannot tell an explicit value from a filled-in
one. **Proven by reverting:** four of the five presets come back magenta.

### 21. Colour asserted the opposite of what had happened — *Stage 9*

`CapacityMeter` turned the attendance register **amber at 93% marked and red at
100%**. Its thresholds were written for a ceiling — a committee at 15 of 15 seats
can take nobody else — and the register was reusing them for a target, where
reaching the end is the best possible morning.

**Fix:** an `intent` of `capacity` or `progress`. Two meanings, two scales, one
component.

**Lesson:** a shared component's *semantics* travel with it, not just its markup.
Reusing it somewhere the meaning inverts is a bug even when every pixel is
correct.

---

## Process

### 11. Test isolation was hiding a lie

`isolate: false` was set so the "no database" skip notice printed once per run instead of once per
file. That shares one module registry across files — and the membership suite stubs the session
module, which the API contract suite silently inherited. **Five tests were passing for a reason
nobody wrote.**

Isolation is back on and **not negotiable**. A tidier notice is not worth tests that pass by
accident.

### 12. CI in Stage 1 paid for itself immediately

The specification defers CI to Stage 8. Building it in Stage 1 caught a `prisma.config.ts` bug on
its very first run — `shadowDatabaseUrl` declared with `env()` made the config fail to load wherever
the variable was absent, **which would have failed the Vercel build identically**.

### 13. npm's `allowScripts` gate

The predecessor's notes warn about this and they are right. Without the approvals committed in
`package.json`, a clean install — which is exactly what CI and Vercel do every time — produces a
tree that cannot generate a Prisma client. Locally you never notice, because `node_modules` already
has the binaries.

Bumping Prisma re-blocks the scripts until the approval is renewed, since they are pinned by version.

---

## The habit that found most of these

**Verify the assumption, do not port it.** Before Stage 1 shipped, `rolbypassrls` was checked
against the real Supabase project rather than assumed — had it been false, every query in the
product would have returned zero rows. Before committing to Prisma 7, `Prisma.dmmf`, client
extensions and transaction scoping were each probed in a scratch project.

**Prove a security fix by reverting it.** A test that passes after a fix has not demonstrated it
catches anything. Traps 1, 8 and 14 were all confirmed by putting the bug back and watching the
suite go red, and each of the three layers of the Stage 7 audit manifest was confirmed by breaking
that layer alone.

**Reverting also proves a *design* decision, not only a fix.** Commenting out `networkMode: 'always'`
and re-running the offline harness reproduces the venue-wifi bug exactly as the predecessor
describes it: the check-in never resolves, never queues and never reports anything. A comment saying
why a line exists is worth more once you have watched its absence.
