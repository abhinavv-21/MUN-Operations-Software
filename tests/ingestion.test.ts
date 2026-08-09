import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { describeIngest, ingestCsv, parseCsv } from '../src/server/ingestion.ts'
import { generateAppsScript, hashSecret, secretMatches } from '../src/server/services/ingest.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = { sub: 'zz_auth_alice', email: 'alice@example.test' }

/**
 * A real Google Forms export, in the shape Forms actually produces: a
 * Timestamp column it adds itself, question text as headers, and — the part
 * that matters — a Committee column the organiser filled in by hand.
 */
const GOOGLE_FORM_CSV = `Timestamp,Full name,Email address,Contact number,School / Institution,Academic level,Committee preference,Second preference,Committee,Country,Dietary requirements
2026/08/01 10:14:02,Priya Sharma,priya@school.test,9810011111,Lucknow Public School,Grade 12,UNSC,WHO,DISEC,France,Vegetarian
2026/08/01 10:19:47,Arjun Rao,ARJUN@school.test,9810022222,City Montessori,Grade 11,WHO,UNSC,UNSC,Japan,
2026/08/01 10:31:05,Meera Iyer,meera@school.test,,Delhi Public School,Grade 12,DISEC,,WHO,Brazil,No nuts`

describe('parsing a spreadsheet', () => {
  it('copes with quotes, embedded commas and newlines', () => {
    const rows = parseCsv('a,b\n"one, two","he said ""hi""\nsecond line"')

    expect(rows[1]![0]).toBe('one, two')
    expect(rows[1]![1]).toBe('he said "hi"\nsecond line')
  })

  it('drops the byte order mark Excel prepends', () => {
    // Otherwise the first header becomes "﻿Full name" and matches nothing.
    const rows = parseCsv('﻿Full name,Email address\nA,a@b.test')
    expect(rows[0]![0]).toBe('Full name')
  })
})

describe('a real Google Forms export', () => {
  const result = ingestCsv(GOOGLE_FORM_CSV)

  it('understands the headers an organiser already has', () => {
    // This is why the product needs no form builder. Their Google Form *is*
    // their custom form, and aliasing is what makes that true.
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({
      fullName: 'Priya Sharma',
      email: 'priya@school.test',
      phone: '9810011111',
      schoolName: 'Lucknow Public School',
      grade: 'Grade 12',
      committeePreference: 'UNSC',
      committeePreference2: 'WHO',
      dietaryNotes: 'Vegetarian',
    })
  })

  it('reports the placement columns and acts on neither', () => {
    // The exit criterion. A "Committee" column in an organiser's own sheet is
    // overwhelmingly where they wrote the allocation by hand, so it is
    // deliberately not an alias of "Committee preference".
    expect(result.ignoredPlacementColumns).toEqual(['Committee', 'Country'])

    for (const row of result.rows) {
      expect(Object.values(row)).not.toContain('France')
      expect(Object.values(row)).not.toContain('Japan')
    }
    // Priya asked for UNSC and the sheet placed her in DISEC. Neither becomes
    // an allocation.
    expect(result.rows[0]!.committeePreference).toBe('UNSC')
  })

  it('says so in a sentence an operator can act on', () => {
    const message = describeIngest(result)
    expect(message).toContain('"Committee" and "Country" were ignored')
    expect(message).toContain('importing never allocates')
  })

  it('reports Timestamp as unrecognised rather than guessing', () => {
    expect(result.unrecognised).toContain('Timestamp')
  })

  it('lower-cases emails so a duplicate is a duplicate', () => {
    expect(result.rows[1]!.email).toBe('arjun@school.test')
  })
})

describe('rows that cannot be imported', () => {
  it('skips a row with no email, naming the spreadsheet row number', () => {
    const result = ingestCsv('Full name,Email address\nPriya Sharma,\nArjun Rao,arjun@school.test')

    expect(result.rows).toHaveLength(1)
    // 2, not 1: it counts the header, so it matches what the operator sees.
    expect(result.skipped[0]).toMatchObject({ row: 2 })
    expect(result.skipped[0]!.reason).toContain('an email address')
  })

  it('skips a malformed email and quotes it back', () => {
    const result = ingestCsv('Full name,Email address\nPriya,not-an-email')
    expect(result.skipped[0]!.reason).toContain('"not-an-email"')
  })

  it('keeps the first of a duplicate within one file', () => {
    const result = ingestCsv(
      'Full name,Email address\nPriya,a@b.test\nPriya Again,A@B.test',
    )

    expect(result.rows).toHaveLength(1)
    expect(result.skipped[0]!.reason).toContain('first seen on row 2')
  })

  it('handles an empty file without throwing', () => {
    expect(ingestCsv('').rows).toEqual([])
  })
})

describe('the webhook secret', () => {
  it('compares in constant time and never stores plaintext', () => {
    const secret = 'a'.repeat(64)
    const stored = hashSecret(secret)

    expect(stored).not.toContain(secret)
    expect(secretMatches(secret, stored)).toBe(true)
    expect(secretMatches('b'.repeat(64), stored)).toBe(false)
  })

  it('bakes the URL and secret into the script the organiser pastes', () => {
    const script = generateAppsScript('https://munopshub.vercel.app/api/integrations/x/1', 'sekret')

    expect(script).toContain('"https://munopshub.vercel.app/api/integrations/x/1"')
    expect(script).toContain('"sekret"')
    expect(script).toContain('X-Webhook-Secret')
    // Failure has to surface in the Apps Script execution log, not vanish.
    expect(script).toContain('muteHttpExceptions')
    expect(script).toContain('throw new Error')
  })
})

describeWithDb('the Google Sheets webhook', () => {
  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.registration.deleteMany({})
    signedIn = null
  })

  afterAll(async () => {
    await resetDatabase()
  })

  async function seedTwoConferences() {
    const { POST } = await import('../src/app/api/orgs/route.ts')
    signedIn = ALICE
    await POST(
      new Request('https://example.test/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alpha MUN Society', slug: 'zz-alpha' }),
      }),
      undefined,
    )
    const org = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-alpha' } })
    const first = await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-xi', name: 'MUN XI', status: 'OPEN' },
    })
    const second = await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-x', name: 'MUN X', status: 'OPEN' },
    })
    return { org, first, second }
  }

  async function issueSecret(conferenceId: string) {
    const { POST } = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/integrations/google-sheets/route.ts'
    )
    const response = await POST(
      new Request(
        `https://munopshub.test/api/orgs/zz-alpha/conferences/${conferenceId}/integrations/google-sheets`,
        { method: 'POST' },
      ),
      { params: Promise.resolve({ orgSlug: 'zz-alpha', conferenceId }) },
    )
    return response.json()
  }

  async function postToWebhook(conferenceId: string, secret: string, csv: string) {
    const { POST } = await import(
      '../src/app/api/integrations/google-sheets/[conferenceId]/route.ts'
    )
    return POST(
      new Request(`https://munopshub.test/api/integrations/google-sheets/${conferenceId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
        body: JSON.stringify({ csv }),
      }),
      { params: Promise.resolve({ conferenceId }) },
    )
  }

  it('imports into the conference the secret belongs to', async () => {
    const { first } = await seedTwoConferences()
    const { secret, webhookUrl, appsScript } = await issueSecret(first.id)

    expect(webhookUrl).toContain(first.id)
    expect(appsScript).toContain(secret)

    const response = await postToWebhook(first.id, secret, GOOGLE_FORM_CSV)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.created).toBe(3)
    expect(body.ignoredPlacementColumns).toEqual(['Committee', 'Country'])

    const rows = await unsafeDb.registration.findMany()
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.conferenceId === first.id)).toBe(true)
    // Importing never allocates.
    expect(await unsafeDb.delegate.count()).toBe(0)
  })

  it('answers 401 when the script is repointed at another conference', async () => {
    const { first, second } = await seedTwoConferences()
    const { secret } = await issueSecret(first.id)
    await issueSecret(second.id)

    // The exit criterion: a working script, one id changed in the URL.
    const response = await postToWebhook(second.id, secret, GOOGLE_FORM_CSV)

    expect(response.status).toBe(401)
    expect(await unsafeDb.registration.count()).toBe(0)
  })

  it('answers 401 identically for a conference with no form connected', async () => {
    const { first, second } = await seedTwoConferences()
    const { secret } = await issueSecret(first.id)

    // Whether a conference has a form connected is not something a caller
    // holding the wrong secret should be able to learn.
    const response = await postToWebhook(second.id, secret, GOOGLE_FORM_CSV)
    expect(response.status).toBe(401)
  })

  it('is idempotent, so a re-sent sheet does not duplicate rows', async () => {
    const { first } = await seedTwoConferences()
    const { secret } = await issueSecret(first.id)

    await postToWebhook(first.id, secret, GOOGLE_FORM_CSV)
    const second = await postToWebhook(first.id, secret, GOOGLE_FORM_CSV)
    const body = await second.json()

    // Exactly what a form webhook does when an organiser runs sendAll twice.
    expect(body.created).toBe(0)
    expect(body.duplicates).toBe(3)
    expect(await unsafeDb.registration.count()).toBe(3)
  })

  it('reissuing a secret invalidates the old one', async () => {
    const { first } = await seedTwoConferences()
    const { secret: original } = await issueSecret(first.id)
    const { secret: replacement } = await issueSecret(first.id)

    expect(replacement).not.toBe(original)
    expect((await postToWebhook(first.id, original, GOOGLE_FORM_CSV)).status).toBe(401)
    expect((await postToWebhook(first.id, replacement, GOOGLE_FORM_CSV)).status).toBe(200)
  })

  it('keeps the secret out of the audit trail', async () => {
    const { first } = await seedTwoConferences()
    const { secret } = await issueSecret(first.id)

    const rows = await unsafeDb.auditLog.findMany()
    expect(JSON.stringify(rows)).not.toContain(secret)
  })
})
