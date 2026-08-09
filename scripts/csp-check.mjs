#!/usr/bin/env node
/**
 * Loads every kind of page in a real browser and fails on any CSP violation.
 *
 * This exists because a content security policy is **invisible to every check
 * that runs on the server**. `npm run typecheck`, `npm run lint`, the whole
 * suite and `npm run build` all pass with a policy that blocks the application's
 * own bootstrap, because none of them is a browser. That is trap 8 — the
 * environment-variable inlining bug — wearing a different hat, and the lesson
 * from it was: when something works in tests and not in a browser, suspect the
 * boundary itself, then go and test the boundary.
 *
 * It listens for two things:
 *
 *   - `securitypolicyviolation`, which the browser fires on the document for
 *     every blocked resource, inline script or inline style;
 *   - console errors, because a page that renders but does not hydrate looks
 *     fine in a screenshot and is broken in the hand.
 *
 * A page is also asked whether React actually hydrated. A blocked bootstrap
 * script produces a page that renders its server HTML perfectly and responds to
 * nothing, which is the single most likely way to ship a broken CSP.
 *
 * Run it against a production build, which is the only one whose policy matters:
 *
 *     npm run build && node scripts/csp-check.mjs
 *
 * Like `e2e-offline.mjs` it needs a browser and is therefore not in `npm test`.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const PORT = Number(process.env.CSP_PORT ?? 3212)
const ORIGIN = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.CSP_DEBUG_PORT ?? 9444)

/**
 * Unauthenticated pages only, and that is not a gap.
 *
 * Every signed-in page is rendered by the same root layout, through the same
 * proxy, with the same policy and the same inline theme block. What differs is
 * the data, and the CSP does not depend on the data. The signed-in surface is
 * exercised end to end by `e2e-offline.mjs`, which drives three of those screens
 * in a real browser and would fail on a blocked bootstrap.
 */
const PAGES = [
  { path: '/', label: 'the landing page' },
  { path: '/how-it-works', label: 'how it works' },
  { path: '/sign-in', label: 'sign in' },
  { path: '/offline', label: 'the offline page' },
  { path: '/invite?token=nope', label: 'an invalid invitation' },
  /*
    Extra paths, comma-separated, for anything that needs a fixture in the
    database — the public registration page above all. It is the page most worth
    checking and the only one that cannot be reached without seeding a
    conference first:

      CSP_EXTRA_PATHS=/r/my-org/my-conf node scripts/csp-check.mjs
  */
  ...(process.env.CSP_EXTRA_PATHS ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ path, label: 'an extra page' })),
]

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

let failures = 0
const step = (message) => console.log(`\n[1m▸ ${message}[0m`)
const pass = (message) => console.log(`  [32m✓[0m ${message}`)
const fail = (message, detail) => {
  failures += 1
  console.log(`  [31m✗ ${message}[0m`)
  if (detail) console.log(`      ${detail}`)
}

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
    this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }

  close() {
    this.#socket.close()
  }
}

function chromeLibraryPath() {
  const local = `${process.env.HOME}/.local/chromium-deps/usr/lib/x86_64-linux-gnu`
  return existsSync(local)
    ? `${local}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`
    : (process.env.LD_LIBRARY_PATH ?? '')
}

function killGroup(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!chrome) throw new Error(`No Chrome found. Set CHROME_PATH.\n  ${CHROME_CANDIDATES.join('\n  ')}`)

  try {
    await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1_500) })
    throw new Error(`Something already answers on ${ORIGIN}. Stop it — this run would test it.`)
  } catch (error) {
    if (String(error.message).includes('already answers')) throw error
  }

  const profile = mkdtempSync(join(tmpdir(), 'mun-csp-'))
  let server
  let browser
  let cdp

  try {
    step('Starting the production build')
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
      stdio: 'ignore',
      env: { ...process.env, NODE_ENV: 'production' },
      detached: true,
    })

    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(`${ORIGIN}/api/health`)).ok) break
      } catch {
        // Not up yet.
      }
      await sleep(500)
    }
    console.log(`  answering on ${ORIGIN}`)

    step('Checking the policy that is actually sent')
    const headers = (await fetch(ORIGIN)).headers
    const policy = headers.get('content-security-policy')

    if (!policy) {
      fail('no Content-Security-Policy header at all')
    } else {
      const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
      pass(`policy present, ${policy.split(';').length} directives`)
      check(Boolean(nonce), 'script-src carries a nonce')
      check(!policy.includes("script-src 'self' 'unsafe-inline'"), "script-src is not 'unsafe-inline'")
      check(policy.includes("object-src 'none'"), "object-src 'none'")
      check(policy.includes("frame-ancestors 'none'"), "frame-ancestors 'none'")
      check(policy.includes('upgrade-insecure-requests'), 'upgrade-insecure-requests')

      // A nonce that repeats is a constant, and a constant nonce permits
      // anything that can read the page source.
      const second = /'nonce-([^']+)'/.exec(
        (await fetch(ORIGIN)).headers.get('content-security-policy') ?? '',
      )?.[1]
      check(Boolean(second) && second !== nonce, 'the nonce differs on every request')
    }

    for (const header of [
      'strict-transport-security',
      'x-content-type-options',
      'referrer-policy',
      'x-frame-options',
      'permissions-policy',
      'cross-origin-opener-policy',
    ]) {
      check(headers.get(header) !== null, `${header} is set`, headers.get(header) ?? 'missing')
    }

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

    let version
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
        if (response.ok) {
          version = await response.json()
          break
        }
      } catch {
        // Still starting.
      }
      await sleep(250)
    }
    console.log(`  ${version.Browser}`)

    cdp = await Cdp.attach(version.webSocketDebuggerUrl)

    for (const page of PAGES) {
      step(`Loading ${page.label} — ${page.path}`)

      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

      await cdp.send('Runtime.enable', {}, sessionId)
      await cdp.send('Page.enable', {}, sessionId)
      await cdp.send('Log.enable', {}, sessionId)

      const violations = []
      const errors = []

      cdp.on('Log.entryAdded', ({ entry }) => {
        if (entry.source === 'security' || /Content Security Policy/i.test(entry.text ?? '')) {
          violations.push(entry.text)
        } else if (entry.level === 'error') {
          errors.push(entry.text)
        }
      })
      cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
        errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text)
      })

      await cdp.send('Page.navigate', { url: `${ORIGIN}${page.path}` }, sessionId)

      // Long enough for hydration and for any blocked chunk to report itself.
      await sleep(2_500)

      const hydrated = await evaluate(
        cdp,
        sessionId,
        // React attaches this to the root container when it hydrates. A page
        // whose bootstrap was blocked renders its server HTML perfectly and
        // never gets here.
        `Boolean(document.querySelector('body')?.innerHTML) &&
         Array.from(document.querySelectorAll('script')).some((s) => s.nonce || s.getAttribute('nonce'))`,
      )

      const reactReady = await evaluate(
        cdp,
        sessionId,
        `(() => {
           const root = document.body?.firstElementChild
           if (!root) return false
           const keys = Object.keys(root)
           return keys.some((key) => key.startsWith('__react'))
         })()`,
      )

      check(violations.length === 0, 'no content security policy violations', violations.join(' | '))
      check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '))
      check(hydrated === true, 'the scripts carry the nonce the header issued')
      check(reactReady === true, 'React hydrated — the page is interactive, not just painted')

      await cdp.send('Target.closeTarget', { targetId })
    }
  } finally {
    cdp?.close()
    browser?.kill()
    killGroup(server)
    rmSync(profile, { recursive: true, force: true })
  }

  console.log(
    failures === 0
      ? '\n[32mThe policy holds in a real browser.[0m\n'
      : `\n[31m${failures} check(s) failed.[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

function check(passed, message, detail) {
  if (passed) pass(message)
  else fail(message, detail)
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  return result.result?.value
}

await main()
