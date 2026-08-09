#!/usr/bin/env node
/**
 * The Stage 7 exit criterion, run in a real browser.
 *
 * Three things have to be true, and none of them can be shown by a unit test,
 * because all three are about what the *browser* does:
 *
 *   1. With the network off, a logistics request and an attendance check-in
 *      both queue, and both land in Postgres on reconnect.
 *   2. Editing a delegate offline fails immediately with "you appear to be
 *      offline" — it does not hang. This is the venue-wifi bug that
 *      `networkMode: 'always'` exists for.
 *   3. Neither of the two is lost if the tab is reloaded while still offline.
 *
 * ## Why the Chrome DevTools Protocol and not Playwright
 *
 * `Network.emulateNetworkConditions` with `offline: true` **is** the devtools
 * Offline checkbox — the panel sends this exact command. Driving it directly
 * needs no dependency at all: Node has had a global `WebSocket` since 22, so
 * this file talks to Chrome over a socket and nothing is installed. A test
 * harness that adds a 130 MB browser download to `npm ci` for one script is a
 * harness that gets deleted.
 *
 * ## What it needs
 *
 *   - a Chrome or Chromium binary (`CHROME_PATH`, or one of the usual places)
 *   - local Postgres, running, with the migrations applied
 *   - the real Supabase credentials in `.env`, because it signs in for real
 *     through the product's own sign-in form rather than forging a cookie
 *
 * It is **not** part of `npm test`: it needs a browser and a network round trip
 * to Supabase, and invariant 5 says the suite stays green on a laptop with
 * neither. Run it by hand:
 *
 *     node scripts/e2e-offline.mjs
 *
 * It builds nothing. Run `npm run build` first, or pass `--dev` to drive the
 * development server instead (the service worker does not register there, which
 * is deliberate — see src/components/offline/OfflineRuntime.tsx).
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const DEV = process.argv.includes('--dev')
const PORT = Number(process.env.E2E_PORT ?? 3210)
const ORIGIN = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9222)

const ORG_SLUG = 'zz-e2e-offline'
const CONFERENCE_SLUG = 'e2e-mun'
const EMAIL = `e2e-offline+${randomUUID().slice(0, 8)}@munops.test`
const PASSWORD = `Pw-${randomUUID()}`

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

let failures = 0
const step = (message) => console.log(`\n[1m▸ ${message}[0m`)
const note = (message) => console.log(`  ${message}`)

function check(passed, message, detail) {
  if (passed) {
    console.log(`  [32m✓[0m ${message}`)
  } else {
    failures += 1
    console.log(`  [31m✗ ${message}[0m`)
    if (detail !== undefined) console.log(`      ${detail}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Postgres                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reads straight from the database rather than through the API.
 *
 * The whole question is whether the row is really there, and asking the
 * application whether it saved something is asking the wrong witness.
 */
function sql(query) {
  return execFileSync('psql', [process.env.DATABASE_URL, '-tAc', query], {
    encoding: 'utf8',
  }).trim()
}

/* -------------------------------------------------------------------------- */
/* Supabase                                                                    */
/* -------------------------------------------------------------------------- */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Creates a confirmed user through the admin API.
 *
 * Email confirmation is on for this project, so a user created by signing up
 * cannot sign in until a link is clicked. `email_confirm: true` on the admin
 * endpoint is the only way to get a usable account without a mailbox.
 */
async function createConfirmedUser() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  })

  if (!response.ok) {
    throw new Error(`Could not create the test user: ${response.status} ${await response.text()}`)
  }

  return (await response.json()).id
}

async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
}

/* -------------------------------------------------------------------------- */
/* CDP                                                                         */
/* -------------------------------------------------------------------------- */

class Cdp {
  #socket
  #next = 1
  #pending = new Map()
  #handlers = new Map()

  static async attach(url) {
    const cdp = new Cdp()
    cdp.#socket = new WebSocket(url)

    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener('open', resolve, { once: true })
      cdp.#socket.addEventListener('error', reject, { once: true })
    })

    cdp.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)

      if (message.id !== undefined) {
        const pending = cdp.#pending.get(message.id)
        cdp.#pending.delete(message.id)
        if (!pending) return
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
        else pending.resolve(message.result)
        return
      }

      for (const handler of cdp.#handlers.get(message.method) ?? []) handler(message.params)
    })

    return cdp
  }

  on(method, handler) {
    const existing = this.#handlers.get(method) ?? []
    existing.push(handler)
    this.#handlers.set(method, existing)
  }

  send(method, params = {}, sessionId) {
    const id = this.#next++
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) }
    this.#socket.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }

  close() {
    this.#socket.close()
  }
}

/* -------------------------------------------------------------------------- */
/* Page helpers                                                                */
/* -------------------------------------------------------------------------- */

function makePage(cdp, sessionId) {
  /** Evaluates an expression in the page and returns its value. */
  async function evaluate(expression) {
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    )
    if (result.exceptionDetails) {
      throw new Error(
        `Page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      )
    }
    return result.result.value
  }

  async function goto(path) {
    await cdp.send('Page.navigate', { url: `${ORIGIN}${path}` }, sessionId)
    await waitFor(`document.readyState === 'complete'`, 30_000, `navigate to ${path}`)
  }

  /** Polls an expression until it is truthy. Everything here is asynchronous. */
  async function waitFor(expression, timeoutMs = 15_000, label = expression) {
    const deadline = Date.now() + timeoutMs
    let lastError
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${expression})`)) return
      } catch (error) {
        lastError = error
      }
      await sleep(120)
    }
    throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`)
  }

  return { evaluate, goto, waitFor }
}

/**
 * Sets a React-controlled input.
 *
 * Assigning `.value` directly updates the DOM node and React never hears about
 * it, so the next render puts the old value back. Going through the prototype's
 * setter and then dispatching `input` is what makes React's onChange fire.
 */
const setInput = (selector, value) => `
  (() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('no element for ${selector}')
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      'value',
    ).set
    setter.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()
`

const clickText = (text, selector = 'button') => `
  (() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})
    if (!target) throw new Error('no ' + ${JSON.stringify(selector)} + ' reading ' + ${JSON.stringify(text)})
    target.click()
    return true
  })()
`

/**
 * The queue, read out of IndexedDB in the page.
 *
 * Read from whichever tab is asked, because the point is that there is one
 * queue per origin and not one per tab.
 */
async function queueKinds(tab) {
  return tab.evaluate(`
    new Promise((resolve, reject) => {
      const open = indexedDB.open('mun-ops-offline')
      open.onerror = () => reject(new Error('cannot open the offline database'))
      open.onsuccess = () => {
        const request = open.result.transaction('writes').objectStore('writes').getAll()
        request.onsuccess = () => resolve(request.result.map((row) => row.kind))
      }
    })
  `)
}

const click = (selector) => `
  (() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!target) throw new Error('no element for ${selector}')
    target.click()
    return true
  })()
`

/* -------------------------------------------------------------------------- */
/* Fixture                                                                     */
/* -------------------------------------------------------------------------- */

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * Builds the conference this run drives, directly in Postgres.
 *
 * Not through the API: the point of the run is the browser, and spending three
 * minutes of it clicking through onboarding tests Stage 2 again. The one thing
 * that has to be real is the identity, which comes from Supabase.
 */
function seed(authUserId) {
  const userId = randomUUID()
  const organizationId = randomUUID()
  const conferenceId = randomUUID()
  const committeeId = randomUUID()
  const delegateId = randomUUID()

  sql(`
    INSERT INTO "User" (id, "authUserId", email, "fullName", "profileCompletedAt", "updatedAt")
    VALUES (${quote(userId)}, ${quote(authUserId)}, ${quote(EMAIL)}, 'E2E Operator', now(), now());

    INSERT INTO "Organization" (id, slug, name, "updatedAt")
    VALUES (${quote(organizationId)}, ${quote(ORG_SLUG)}, 'E2E Offline Society', now());

    INSERT INTO "Membership" (id, "userId", "organizationId", role, "canManageMembers", "updatedAt")
    VALUES (${quote(randomUUID())}, ${quote(userId)}, ${quote(organizationId)}, 'OWNER', true, now());

    INSERT INTO "Conference" (id, "organizationId", slug, name, status, "updatedAt")
    VALUES (${quote(conferenceId)}, ${quote(organizationId)}, ${quote(CONFERENCE_SLUG)}, 'E2E MUN', 'OPEN', now());

    INSERT INTO "Committee" (id, "conferenceId", code, name, seats, "updatedAt")
    VALUES (${quote(committeeId)}, ${quote(conferenceId)}, 'UNSC', 'Security Council', 20, now());

    INSERT INTO "Delegate" (id, "conferenceId", "fullName", email, "schoolName", "updatedAt")
    VALUES (${quote(delegateId)}, ${quote(conferenceId)}, 'Dara Okafor', 'dara@e2e.test', 'Riverside High', now());

    INSERT INTO "Assignment" (id, "conferenceId", "committeeId", "delegateId", country, "updatedAt")
    VALUES (${quote(randomUUID())}, ${quote(conferenceId)}, ${quote(committeeId)}, ${quote(delegateId)}, 'France', now());
  `)

  return { userId, organizationId, conferenceId, delegateId }
}

function cleanup() {
  sql(`
    DELETE FROM "Organization" WHERE slug = ${quote(ORG_SLUG)};
    DELETE FROM "User" WHERE email = ${quote(EMAIL)};
  `)
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

async function portIsTaken() {
  try {
    await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1_500) })
    return true
  } catch {
    return false
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`)
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    await sleep(500)
  }
  throw new Error(`The app did not answer on ${ORIGIN} within 60 seconds`)
}

async function main() {
  for (const variable of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[variable]) throw new Error(`${variable} is not set. See docs/06-ENVIRONMENT.md.`)
  }

  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!chrome) {
    throw new Error(
      `No Chrome found. Set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    )
  }

  const profile = mkdtempSync(join(tmpdir(), 'mun-e2e-'))
  let server
  let browser
  let cdp
  let authUserId

  try {
    step('Starting the application')
    if (await portIsTaken()) {
      throw new Error(
        `Something is already listening on ${ORIGIN}. Stop it first — otherwise this run drives ` +
          `whatever build that is, and a green result would mean nothing.`,
      )
    }
    /*
      `detached: true`, so the whole process group can be killed at the end.

      `npx` forks `next`, which forks `next-server`. Killing the `npx` pid
      leaves the actual server holding the port, and the next run of this script
      then silently drives the *previous* build — which is exactly how a
      reverted-fix check came back green once during Stage 7 and wasted twenty
      minutes.
    */
    server = spawn(
      'npx',
      DEV ? ['next', 'dev', '-p', String(PORT)] : ['next', 'start', '-p', String(PORT)],
      { cwd: process.cwd(), stdio: 'ignore', env: process.env, detached: true },
    )
    await waitForServer()
    note(`${DEV ? 'next dev' : 'next start'} answering on ${ORIGIN}`)

    step('Creating a confirmed Supabase user and seeding one conference')
    cleanup()
    authUserId = await createConfirmedUser()
    const fixture = seed(authUserId)
    note(`${EMAIL} owns ${ORG_SLUG}/${CONFERENCE_SLUG} with one delegate`)

    step('Launching Chrome')
    browser = spawn(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore', env: { ...process.env, LD_LIBRARY_PATH: chromeLibraryPath() } },
    )

    const version = await waitForDevtools()
    note(version.Browser)

    cdp = await Cdp.attach(version.webSocketDebuggerUrl)

    /*
      One tab per screen, all opened while the network is up.

      Not a flourish. A Next App Router navigation fetches the next segment's
      payload from the server, so moving between screens *while offline* fails —
      correctly, and it is what the offline page is for. Driving three screens
      therefore means three tabs, which is also the situation the design is
      actually for: the door desk has the register open on one device and
      logistics is open on another. They share one origin, so they share one
      IndexedDB queue, and that is worth seeing.
    */
    const tabs = []

    async function newTab() {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

      await cdp.send('Page.enable', {}, sessionId)
      await cdp.send('Runtime.enable', {}, sessionId)
      await cdp.send('Network.enable', {}, sessionId)

      const tab = {
        ...makePage(cdp, sessionId),
        sessionId,
        reload: () => cdp.send('Page.reload', {}, sessionId),
      }
      tabs.push(tab)
      return tab
    }

    /** The devtools Offline checkbox, sent to every tab as the panel sends it. */
    const setOffline = async (offline) => {
      for (const tab of tabs) {
        await cdp.send(
          'Network.emulateNetworkConditions',
          {
            offline,
            latency: 0,
            downloadThroughput: offline ? 0 : -1,
            uploadThroughput: offline ? 0 : -1,
          },
          tab.sessionId,
        )
      }
    }

    const page = await newTab()

    /* ---------------------------------------------------------------- */

    step('Signing in through the product’s own sign-in form')
    await page.goto('/sign-in')
    await page.waitFor(`document.querySelector('input[type=email]')`)
    await page.evaluate(setInput('input[type=email]', EMAIL))
    await page.evaluate(clickText('Continue'))
    await page.waitFor(`document.querySelector('input[type=password]')`, 20_000, 'the password step')
    await page.evaluate(setInput('input[type=password]', PASSWORD))
    await page.evaluate(clickText('Sign in'))
    await page.waitFor(`location.pathname.startsWith('/app')`, 30_000, 'the app to load')
    check(true, 'signed in, with a real Supabase session cookie')

    const attendancePath = `/app/${ORG_SLUG}/conferences/${fixture.conferenceId}/attendance`
    const logisticsPath = `/app/${ORG_SLUG}/conferences/${fixture.conferenceId}/logistics`
    const delegatesPath = `/app/${ORG_SLUG}/conferences/${fixture.conferenceId}/delegates`

    step('Opening the three screens while the network is up')
    const register = page
    await register.goto(attendancePath)
    await register.waitFor(`document.body.textContent.includes('Dara Okafor')`, 20_000, 'the register')
    note('tab 1 — the register, as it sits on the door desk')

    const board = await newTab()
    await board.goto(logisticsPath)
    await board.waitFor(
      `document.querySelector('[data-testid=new-logistics]')`,
      20_000,
      'the logistics board',
    )
    note('tab 2 — the logistics board')

    const roster = await newTab()
    await roster.goto(delegatesPath)
    await roster.waitFor(
      `document.querySelector('[data-testid=edit-delegate]')`,
      20_000,
      'the delegate list',
    )
    note('tab 3 — the delegate list')
    check(true, 'all three screens loaded')

    /* ---------------------------------------------------------------- */

    step('Going offline — Network.emulateNetworkConditions { offline: true }')
    await setOffline(true)
    for (const tab of [register, board, roster]) {
      await tab.waitFor(`navigator.onLine === false`, 10_000, 'the browser to report itself offline')
    }
    check(true, 'navigator.onLine is false in every tab, as the devtools toggle leaves it')

    /* ---------------------------------------------------------------- */

    step('Criterion 1a — an attendance check-in, made offline')
    await register.evaluate(click('[data-testid=mark-present]'))
    await register.waitFor(
      `document.body.textContent.includes('waiting to send')`,
      10_000,
      'the row to show the mark as queued',
    )

    const attendanceRowsWhileOffline = Number(sql(`SELECT count(*) FROM "AttendanceRecord"`))
    check(
      attendanceRowsWhileOffline === 0,
      'nothing reached the database, because there is no network',
      `found ${attendanceRowsWhileOffline} rows`,
    )
    check((await queueKinds(register)).length === 1, 'it is in the Dexie queue')

    /* ---------------------------------------------------------------- */

    step('Criterion 1b — a logistics request, made offline')
    await board.evaluate(click('[data-testid=new-logistics]'))
    await board.waitFor(`document.querySelector('[data-testid=logistics-title]')`)
    await board.evaluate(setInput('[data-testid=logistics-title]', 'Projector in UNSC has no signal'))
    await board.evaluate(click('[data-testid=submit-logistics]'))
    await board.waitFor(
      `document.body.textContent.includes('waiting to send')`,
      10_000,
      'the acknowledgement that it was saved on the device',
    )

    const logisticsRowsWhileOffline = Number(sql(`SELECT count(*) FROM "LogisticsRequest"`))
    check(
      logisticsRowsWhileOffline === 0,
      'nothing reached the database, because there is no network',
      `found ${logisticsRowsWhileOffline} rows`,
    )

    const queued = await queueKinds(board)
    check(
      JSON.stringify(queued) === JSON.stringify(['attendance.checkin', 'logistics.create']),
      'both writes are in one queue, in the order they were made — and the second tab can ' +
        'see the first tab’s write, because the queue is the origin’s, not the tab’s',
      JSON.stringify(queued),
    )

    /* ---------------------------------------------------------------- */

    step('Criterion 2 — editing a delegate offline fails immediately')
    await roster.evaluate(click('[data-testid=edit-delegate]'))
    await roster.waitFor(`document.querySelector('[data-testid=edit-name]')`)
    await roster.evaluate(setInput('[data-testid=edit-name]', 'Dara Okafor-Adeyemi'))

    const started = Date.now()
    await roster.evaluate(click('[data-testid=save-delegate]'))
    await roster.waitFor(
      `document.body.textContent.includes('You appear to be offline')`,
      10_000,
      'the offline error',
    )
    const elapsed = Date.now() - started

    check(
      elapsed < 3_000,
      `it failed in ${elapsed} ms rather than hanging on "Saving"`,
      `took ${elapsed} ms`,
    )

    const message = await roster.evaluate(
      `document.querySelector('[role=alert]')?.textContent ?? ''`,
    )
    check(
      message.includes('You appear to be offline'),
      'and it said so, in words: ' + JSON.stringify(message.trim().slice(0, 100)),
    )

    const stillQueued = await queueKinds(roster)
    check(
      stillQueued.length === 2,
      'the edit was NOT queued — the queue still holds exactly the two writes',
      JSON.stringify(stillQueued),
    )

    const delegateName = sql(
      `SELECT "fullName" FROM "Delegate" WHERE id = ${quote(fixture.delegateId)}`,
    )
    check(delegateName === 'Dara Okafor', 'and nothing was written for it', delegateName)

    step('Criterion 3 — the queue survives a reload while still offline')
    await register.reload()
    // The reload lands on the offline page, which is the service worker doing
    // its one job. IndexedDB belongs to the origin, so the queue is untouched.
    await sleep(2_000)
    const survived = await queueKinds(register)
    check(
      survived.length === 2,
      'both writes are still there after the tab reloaded onto the offline page',
      JSON.stringify(survived),
    )

    /* ---------------------------------------------------------------- */

    step('Reconnecting')
    await setOffline(false)
    for (const tab of [board, roster]) {
      await tab.waitFor(`navigator.onLine === true`, 10_000, 'the browser to report itself online')
    }

    // The queue flushes on the `online` event. Give it the round trips.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const attendance = Number(sql(`SELECT count(*) FROM "AttendanceRecord"`))
      const logistics = Number(sql(`SELECT count(*) FROM "LogisticsRequest"`))
      if (attendance >= 1 && logistics >= 1) break
      await sleep(500)
    }

    const landed = sql(`
      SELECT (SELECT count(*) FROM "AttendanceRecord") || '/' ||
             (SELECT count(*) FROM "LogisticsRequest")
    `)
    check(landed === '1/1', `both writes landed in Postgres (attendance/logistics = ${landed})`)

    const attendanceRow = sql(`
      SELECT d."fullName" || ' · ' || a.status || ' · ' || a.day
      FROM "AttendanceRecord" a JOIN "Delegate" d ON d.id = a."delegateId"
    `)
    check(
      attendanceRow.includes('Dara Okafor') && attendanceRow.includes('PRESENT'),
      `attendance row: ${attendanceRow}`,
    )

    const logisticsRow = sql(`
      SELECT title || ' · ' || status || ' · ' ||
             CASE WHEN "clientRequestId" IS NULL THEN 'no token' ELSE 'idempotency token present' END
      FROM "LogisticsRequest"
    `)
    check(
      logisticsRow.includes('Projector in UNSC') && logisticsRow.includes('token present'),
      `logistics row: ${logisticsRow}`,
    )

    const drained = await queueKinds(board)
    check(drained.length === 0, 'the queue drained', JSON.stringify(drained))

    const auditActions = sql(`
      SELECT string_agg(DISTINCT action, ', ' ORDER BY action) FROM "AuditLog"
      WHERE action IN ('attendance.checkin', 'logistics.create')
    `)
    check(
      auditActions === 'attendance.checkin, logistics.create',
      `both replays wrote their audit rows: ${auditActions}`,
    )

    /* ---------------------------------------------------------------- */

    step('And the edit works again, now there is a connection')
    await roster.goto(delegatesPath)
    await roster.waitFor(`document.querySelector('[data-testid=edit-delegate]')`, 20_000, 'the delegate list')
    await roster.evaluate(click('[data-testid=edit-delegate]'))
    await roster.waitFor(`document.querySelector('[data-testid=edit-name]')`)
    await roster.evaluate(setInput('[data-testid=edit-name]', 'Dara Okafor-Adeyemi'))
    await roster.evaluate(click('[data-testid=save-delegate]'))

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        sql(`SELECT "fullName" FROM "Delegate" WHERE id = ${quote(fixture.delegateId)}`) ===
        'Dara Okafor-Adeyemi'
      ) {
        break
      }
      await sleep(400)
    }
    check(
      sql(`SELECT "fullName" FROM "Delegate" WHERE id = ${quote(fixture.delegateId)}`) ===
        'Dara Okafor-Adeyemi',
      'the same edit that failed fast offline saves normally online',
    )
  } finally {
    cdp?.close()
    browser?.kill()
    killGroup(server)
    if (authUserId) await deleteUser(authUserId)
    try {
      cleanup()
    } catch {
      // The database may already be gone; nothing here is worth failing over.
    }
    rmSync(profile, { recursive: true, force: true })
  }

  console.log(
    failures === 0
      ? '\n[32mExit criterion met.[0m\n'
      : `\n[31m${failures} check(s) failed.[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

/** Kills a detached child and everything it forked. */
function killGroup(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/**
 * WSL has no `libnss3`, `libnspr4` or `libasound2` and no way to install one
 * without a TTY for sudo. They are unpacked rootless into `~/.local` — the same
 * pattern `docs/06-ENVIRONMENT.md` describes for Postgres.
 */
function chromeLibraryPath() {
  const local = `${process.env.HOME}/.local/chromium-deps/usr/lib/x86_64-linux-gnu`
  return existsSync(local)
    ? `${local}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`
    : (process.env.LD_LIBRARY_PATH ?? '')
}

async function waitForDevtools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // Chrome is still starting.
    }
    await sleep(250)
  }
  throw new Error('Chrome never opened its debugging port')
}

await main()
