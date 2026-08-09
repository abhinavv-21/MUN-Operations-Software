#!/usr/bin/env node
/**
 * Runs before `next dev`.
 *
 * WSL has no init system, so the local Postgres cluster does not come back
 * after a reboot. Without this you get a dev server that boots fine and then
 * fails on the first query with a connection error five minutes later.
 *
 * It warns and continues rather than exiting: a database being down is not a
 * reason to refuse to render the marketing pages.
 */
import { createConnection } from 'node:net'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const url = process.env.DATABASE_URL
if (!url) {
  console.warn('\n  DATABASE_URL is not set. Copy .env.example to .env.\n')
  process.exit(0)
}

let host = '127.0.0.1'
let port = 5432
try {
  const parsed = new URL(url)
  host = parsed.hostname || host
  port = Number(parsed.port || 5432)
} catch {
  console.warn('\n  DATABASE_URL is not a URL this script could parse. Skipping the check.\n')
  process.exit(0)
}

const reachable = await new Promise((resolve) => {
  const socket = createConnection({ host, port })
  const done = (result) => {
    socket.destroy()
    resolve(result)
  }
  socket.setTimeout(2000)
  socket.once('connect', () => done(true))
  socket.once('timeout', () => done(false))
  socket.once('error', () => done(false))
})

if (!reachable) {
  const local = host === '127.0.0.1' || host === 'localhost'
  console.warn(
    `\n  Postgres is not answering on ${host}:${port}.` +
      (local ? '\n  Start it with:  mun-pg start' : '') +
      '\n',
  )
}
