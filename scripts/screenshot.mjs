#!/usr/bin/env node
/**
 * Screenshots any set of pages, at any width, from a real browser.
 *
 * Design work needs a picture. Reading `className` strings tells you what you
 * asked for; a screenshot tells you what happened, and the two differ more
 * often than is comfortable — trap 5 in `07-TRAPS.md` was a text colour that
 * `tailwind-merge` deleted, found by reading the rendered HTML rather than the
 * source.
 *
 * ```bash
 * npm run db:seed                                  # something worth looking at
 * npm run build && node scripts/screenshot.mjs     # the public pages
 * node scripts/screenshot.mjs --width=390          # the phone
 * node scripts/screenshot.mjs --paths=/,/how-it-works --out=.screenshots
 * SHOT_EMAIL=you@example.com node scripts/screenshot.mjs --paths=/app/demo-mun-society
 * ```
 *
 * With `SHOT_EMAIL` and `SHOT_PASSWORD` it signs in through the product's own
 * form first, so signed-in screens can be shot too. Without them it stays on
 * the public pages.
 *
 * Not part of `npm test`: it needs a browser. Same Chrome discovery and same
 * rootless library path as `csp-check.mjs` — see `08-TESTING.md`.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const argument = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`))
  return match ? match.slice(name.length + 3) : fallback
}

const PORT = Number(argument('port', process.env.SHOT_PORT ?? 3230))
const ORIGIN = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(argument('debug-port', 9460))
const WIDTH = Number(argument('width', 1440))
const HEIGHT = Number(argument('height', WIDTH < 700 ? 844 : 1000))
const OUT = resolve(argument('out', '.screenshots'))
const FULL = argument('full', 'true') !== 'false'

const PATHS = argument('paths', '/,/how-it-works,/sign-in')
  .split(',')
  .map((path) => path.trim())
  .filter(Boolean)

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/* -------------------------------------------------------------------------- */

class Cdp {
  #socket
  #next = 1
  #pending = new Map()

  static async attach(url) {
    const cdp = new Cdp()
    cdp.#socket = new WebSocket(url)
    await new Promise((resolve_, reject) => {
      cdp.#socket.addEventListener('open', resolve_, { once: true })
      cdp.#socket.addEventListener('error', reject, { once: true })
    })
    cdp.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return
      const pending = cdp.#pending.get(message.id)
      cdp.#pending.delete(message.id)
      if (!pending) return
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
    return cdp
  }

  send(method, params = {}, sessionId) {
    const id = this.#next++
    this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve_, reject) => this.#pending.set(id, { resolve: resolve_, reject }))
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

const setInput = (selector, value) => `
  (() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('no ' + ${JSON.stringify(selector)})
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()
`

const clickText = (text) => `
  (() => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => node.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})
    if (!button) throw new Error('no button reading ' + ${JSON.stringify(text)})
    button.click()
    return true
  })()
`

/* -------------------------------------------------------------------------- */

async function main() {
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!chrome) throw new Error(`No Chrome found. Set CHROME_PATH.\n  ${CHROME_CANDIDATES.join('\n  ')}`)

  // Never shoot a server this script did not start: a leaked one from an
  // earlier run means every picture is of the previous build, which has wasted
  // an afternoon before. See traps 15 and 17.
  let occupied = false
  try {
    await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1_500) })
    occupied = true
  } catch {
    occupied = false
  }
  if (occupied) throw new Error(`Something already answers on ${ORIGIN}. Stop it first.`)

  mkdirSync(OUT, { recursive: true })
  const profile = mkdtempSync(join(tmpdir(), 'mun-shot-'))
  let server
  let browser
  let cdp

  try {
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
      stdio: 'ignore',
      env: process.env,
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

    browser = spawn(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        // Deterministic pictures: no caret blink, no animation mid-frame.
        '--force-prefers-reduced-motion',
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

    cdp = await Cdp.attach(version.webSocketDebuggerUrl)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: WIDTH < 700 },
      sessionId,
    )

    const evaluate = async (expression) => {
      const result = await cdp.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      )
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      }
      return result.result.value
    }

    const waitFor = async (expression, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try {
          if (await evaluate(`Boolean(${expression})`)) return true
        } catch {
          // Not there yet.
        }
        await sleep(120)
      }
      return false
    }

    const goto = async (path) => {
      await cdp.send('Page.navigate', { url: `${ORIGIN}${path}` }, sessionId)
      await waitFor(`document.readyState === 'complete'`)
    }

    if (process.env.SHOT_EMAIL && process.env.SHOT_PASSWORD) {
      await goto('/sign-in')
      await waitFor(`document.querySelector('input[type=email]')`)
      await evaluate(setInput('input[type=email]', process.env.SHOT_EMAIL))
      await evaluate(clickText('Continue'))
      await waitFor(`document.querySelector('input[type=password]')`)
      await evaluate(setInput('input[type=password]', process.env.SHOT_PASSWORD))
      await evaluate(clickText('Sign in'))
      await waitFor(`location.pathname.startsWith('/app')`, 30_000)
      console.log(`signed in as ${process.env.SHOT_EMAIL}`)
    }

    for (const path of PATHS) {
      await goto(path)
      // Fonts settled and skeletons replaced, or the picture is of a loading
      // state that lasted 200ms.
      await evaluate('document.fonts.ready').catch(() => {})
      await waitFor(`!document.querySelector('[aria-busy="true"]')`, 8_000)
      await sleep(500)

      const { data } = await cdp.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: FULL },
        sessionId,
      )

      const name = `${WIDTH}${(path === '/' ? '-home' : path.replace(/[^a-zA-Z0-9]+/g, '-')).replace(/-+$/, '')}.png`
      writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
      console.log(`  ${join(OUT, name)}`)
    }
  } finally {
    cdp?.close()
    browser?.kill()
    killGroup(server)
    rmSync(profile, { recursive: true, force: true })
  }
}

await main()
