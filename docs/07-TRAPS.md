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
catches anything. Traps 1 and 8 were both confirmed by putting the bug back and watching the suite
go red.
