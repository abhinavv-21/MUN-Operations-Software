import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyAttempt,
  describeAge,
  isQueueable,
  MAX_ATTEMPTS,
  QUEUEABLE_KINDS,
} from '../src/lib/offline/policy.ts'

const SOURCE_ROOT = join(import.meta.dirname, '..', 'src')

/**
 * The offline policy, tested without a browser.
 *
 * The rule these guard is the one Stage 7 is actually about: **exactly two
 * writes may be queued.** The browser half is proved end to end by
 * `scripts/e2e-offline.mjs`, which drives a real Chrome with the network turned
 * off; this is the half that can run in CI on a machine with no browser.
 */
describe('what may be queued', () => {
  it('is exactly two writes', () => {
    // A third entry here is a product decision, not a refactor. Queueing an
    // edit means queueing a conflict that cannot be resolved later without a
    // merge dialog nobody will understand.
    expect([...QUEUEABLE_KINDS]).toEqual(['logistics.create', 'attendance.checkin'])
  })

  it('refuses anything else', () => {
    expect(isQueueable('delegate.update')).toBe(false)
    expect(isQueueable('allocation.create')).toBe(false)
    expect(isQueueable('logistics.update')).toBe(false)
    expect(isQueueable('award.create')).toBe(false)
  })

  /**
   * Both queueable writes must be idempotent on the server, or replaying them
   * duplicates work. This checks the mechanism is present rather than trusting
   * the comment that says it is.
   */
  it('only queues writes the server can safely receive twice', () => {
    const attendance = readFileSync(join(SOURCE_ROOT, 'server/services/attendance.ts'), 'utf8')
    const logistics = readFileSync(join(SOURCE_ROOT, 'server/services/logistics.ts'), 'utf8')
    const schema = readFileSync(join(SOURCE_ROOT, '..', 'prisma', 'schema.prisma'), 'utf8')

    // Attendance is keyed naturally: one delegate, one day.
    expect(schema).toContain('@@unique([conferenceId, delegateId, day])')
    expect(attendance).toContain('runSerializable')

    // Logistics has no natural key, so it carries a client-minted one.
    expect(schema).toContain('@@unique([conferenceId, clientRequestId])')
    expect(logistics).toContain('clientRequestId')
  })
})

describe('what happens to a queued write after an attempt', () => {
  it('drops it once it has landed', () => {
    expect(classifyAttempt({ ok: true }, 0)).toEqual({ verdict: 'done' })
  })

  it('keeps it when the request never reached the API', () => {
    // Continuing down the queue here would burn every entry's attempt counter
    // against the same dead network.
    expect(classifyAttempt({ ok: false, code: 0, message: 'offline' }, 0).verdict).toBe('retry')
  })

  it('keeps it through a 401, because a sleeping tab gets exactly one', () => {
    // The session cookie is refreshed by the Edge proxy on a navigation. A tab
    // asleep in someone's pocket since the morning session sees one 401 before
    // that happens, and dropping a check-in for it loses a delegate who was
    // standing at the desk.
    expect(classifyAttempt({ ok: false, code: 401, message: 'expired' }, 0).verdict).toBe('retry')
  })

  it('keeps it through a 429 and a 500', () => {
    expect(classifyAttempt({ ok: false, code: 429, message: 'slow down' }, 0).verdict).toBe('retry')
    expect(classifyAttempt({ ok: false, code: 503, message: 'down' }, 0).verdict).toBe('retry')
  })

  it('drops a write the server refused on its merits', () => {
    // Retrying a 422 forever means the queue never empties, the pill says
    // "3 pending" for the rest of the conference, and everyone learns to
    // ignore it.
    const outcome = classifyAttempt({ ok: false, code: 422, message: 'Validation failed' }, 0)
    expect(outcome.verdict).toBe('drop')
    expect(outcome).toMatchObject({ reason: 'Validation failed' })
  })

  it('drops a 404, because the conference it belonged to is gone', () => {
    expect(classifyAttempt({ ok: false, code: 404, message: 'Not found' }, 0).verdict).toBe('drop')
  })

  it('gives up eventually rather than retrying for the whole conference', () => {
    const last = classifyAttempt({ ok: false, code: 0, message: 'offline' }, MAX_ATTEMPTS - 1)
    expect(last.verdict).toBe('drop')
    expect(last).toMatchObject({ reason: expect.stringContaining(`${MAX_ATTEMPTS} attempts`) })
  })
})

describe('the two writes call the queue and nothing else does', () => {
  /**
   * The other half of the rule, checked against the source.
   *
   * A policy file that says "two writes" is worth nothing if a third screen
   * imports `sendOrQueue` next month. This names the files allowed to.
   */
  const ALLOWED = [
    'src/app/app/[orgSlug]/conferences/[conferenceId]/attendance/AttendanceClient.tsx',
    'src/app/app/[orgSlug]/conferences/[conferenceId]/logistics/LogisticsClient.tsx',
  ]

  it('is imported only by the check-in screen and the logistics form', async () => {
    const { execSync } = await import('node:child_process')
    // Matches the import line, not the identifier. Grepping for the bare name
    // finds the comment in DelegatesClient that explains why that screen
    // deliberately does *not* use it — which is exactly the comment that should
    // be there, and would fail this test for the wrong reason.
    const output = execSync(
      "grep -rlE \"import \\{[^}]*sendOrQueue[^}]*\\} from '@/lib/offline/queue\" src " +
        "--include='*.tsx' --include='*.ts' || true",
      { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' },
    )

    const callers = output
      .split('\n')
      .filter((line) => line !== '')
      // The queue module defines it; the policy module documents it.
      .filter((line) => !line.startsWith('src/lib/offline/'))
      .sort()

    expect(
      callers,
      'Only the attendance and logistics screens may queue a write. Everything else must fail ' +
        'fast — see src/lib/offline/policy.ts.',
    ).toEqual(ALLOWED.sort())
  })
})

describe('the pending line', () => {
  it('reads in words rather than a timestamp', () => {
    const now = Date.parse('2026-03-14T10:00:00Z')
    expect(describeAge(now - 5_000, now)).toBe('just now')
    expect(describeAge(now - 4 * 60_000, now)).toBe('4 min ago')
    expect(describeAge(now - 3 * 3_600_000, now)).toBe('3 h ago')
  })
})
