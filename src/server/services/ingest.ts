import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { scope, scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { requireConference, type Ctx } from '../ctx.ts'
import { assertWithinLimit } from '../limits.ts'
import { generateReference, LIVE_REGISTRATION_STATUSES } from '../registrations.ts'
import { describeIngest, ingestCsv, type IngestResult, type IngestRow } from '../ingestion.ts'
import { unsafeDb } from '../db.ts'

export const importCsvSchema = z.object({
  csv: z.string().min(1, 'Paste or upload a CSV').max(2_000_000),
})

export interface ImportSummary {
  created: number
  duplicates: number
  recognised: string[]
  unrecognised: string[]
  ignoredPlacementColumns: string[]
  skipped: { row: number; reason: string }[]
  message: string
}

/**
 * Writes parsed rows in as registrations.
 *
 * Deliberately creates **registrations**, not delegates. An import is a stack
 * of applications arriving by another route; approving them is still a decision
 * an organiser takes one at a time, and that decision is where a delegate comes
 * from.
 */
async function persist(
  db: ReturnType<typeof scope>,
  conferenceSlug: string,
  organization: { planKey: string; planLimits?: unknown },
  rows: IngestRow[],
): Promise<{ created: number; duplicates: number }> {
  let created = 0
  let duplicates = 0

  for (const row of rows) {
    const existing = await db.registration.findFirst({
      where: { email: row.email, status: { in: [...LIVE_REGISTRATION_STATUSES] } },
      select: { id: true },
    })
    // Idempotent by email, so re-running an import after fixing three rows does
    // not duplicate the ninety that were already fine — which is exactly what a
    // Google Form webhook does on every re-send.
    if (existing) {
      duplicates += 1
      continue
    }

    const current = await db.registration.count()
    assertWithinLimit(organization, 'maxDelegatesPerConference', current)

    await db.registration.create({
      data: scopedCreate<Prisma.RegistrationUncheckedCreateInput>({
        reference: generateReference(conferenceSlug),
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        schoolName: row.schoolName,
        grade: row.grade,
        committeePreference: row.committeePreference,
        committeePreference2: row.committeePreference2,
        dietaryNotes: row.dietaryNotes,
        accessibilityNotes: row.accessibilityNotes,
      }),
    })
    created += 1
  }

  return { created, duplicates }
}

function summarise(result: IngestResult, counts: { created: number; duplicates: number }) {
  return {
    created: counts.created,
    duplicates: counts.duplicates,
    recognised: result.recognised,
    unrecognised: result.unrecognised,
    ignoredPlacementColumns: result.ignoredPlacementColumns,
    skipped: result.skipped,
    message: describeIngest(result),
  }
}

/** Organiser-driven import, from the review queue. */
export async function importRegistrationsCsv(ctx: Ctx, csv: string): Promise<ImportSummary> {
  requireConference(ctx)
  const organizationId = ctx.organizationId
  if (!organizationId) throw ApiError.notFound('Not found')

  const [organization, conference] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { planKey: true, planLimits: true },
    }),
    ctx.db.conference.findFirstOrThrow({
      where: { id: ctx.conferenceId },
      select: { slug: true },
    }),
  ])

  const result = ingestCsv(csv)
  const counts = await persist(ctx.db, conference.slug, organization, result.rows)

  await ctx.audit.record({
    action: 'registration.import',
    entityType: 'Conference',
    entityId: ctx.conferenceId,
    payloadAfter: {
      created: counts.created,
      duplicates: counts.duplicates,
      ignoredPlacementColumns: result.ignoredPlacementColumns,
      skipped: result.skipped.length,
    },
  })

  return summarise(result, counts)
}

/* ------------------------------ Google Sheets ----------------------------- */

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Comparing with `===` leaks how many leading characters matched, which over
 * enough attempts recovers the secret one nibble at a time.
 */
export function secretMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(presented), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface IntegrationSecret {
  secret: string
  webhookUrl: string
}

/**
 * Issues (or reissues) the webhook secret for a conference.
 *
 * Only the SHA-256 is stored, so the table cannot be read back into a working
 * credential — the same reasoning as invitation tokens. The plaintext is
 * returned exactly once, at the moment it is created, and lives thereafter only
 * inside the Apps Script the organiser pastes into their own sheet.
 */
export async function issueSheetsSecret(ctx: Ctx, baseUrl: string): Promise<IntegrationSecret> {
  const conferenceId = requireConference(ctx)
  if (ctx.conferenceRole !== 'ADMIN') {
    throw ApiError.forbidden('Only a conference admin can connect a form')
  }

  const secret = `${randomUUID()}${randomUUID()}`.replace(/-/g, '')
  const secretHash = hashSecret(secret)

  const existing = await ctx.db.conferenceIntegration.findFirst({
    where: { kind: 'GOOGLE_SHEETS' },
    select: { id: true },
  })

  if (existing) {
    await ctx.db.conferenceIntegration.update({
      where: { id: existing.id },
      data: { secretHash },
    })
  } else {
    await ctx.db.conferenceIntegration.create({
      data: scopedCreate<Prisma.ConferenceIntegrationUncheckedCreateInput>({
        kind: 'GOOGLE_SHEETS',
        secretHash,
      }),
    })
  }

  await ctx.audit.record({
    action: 'integration.issue_secret',
    entityType: 'ConferenceIntegration',
    entityId: conferenceId,
    // The secret never reaches the audit trail. `secretHash` is on the
    // redaction list for the same reason a hash is still a lookup key.
    payloadAfter: { kind: 'GOOGLE_SHEETS', reissued: existing !== null },
  })

  return {
    secret,
    webhookUrl: `${baseUrl}/api/integrations/google-sheets/${conferenceId}`,
  }
}

/**
 * Accepts rows pushed by an organiser's Apps Script.
 *
 * Unauthenticated in the session sense — the secret *is* the credential, and it
 * is bound to one conference. Repointing a working script at another
 * conference's id therefore fails: that conference has a different secret, and
 * the compare is against the row for the conference in the URL.
 */
export async function ingestFromSheets(
  conferenceId: string,
  presentedSecret: string,
  csv: string,
): Promise<ImportSummary> {
  // A scope-discovery read: the URL names the conference and the secret proves
  // the caller may write to it. There is no session to resolve.
  const integration = await unsafeDb.conferenceIntegration.findFirst({
    where: { conferenceId, kind: 'GOOGLE_SHEETS' },
    select: {
      id: true,
      secretHash: true,
      conference: {
        select: {
          id: true,
          slug: true,
          organizationId: true,
          organization: { select: { planKey: true, planLimits: true } },
        },
      },
    },
  })

  // Unconfigured and wrong-secret answer identically. Whether a given
  // conference has a form connected is not something a caller holding the wrong
  // secret should learn.
  if (!integration || !secretMatches(presentedSecret, integration.secretHash)) {
    throw ApiError.unauthorized('That secret is not valid for this conference')
  }

  const conference = integration.conference
  const db = scope({ organizationId: conference.organizationId, conferenceId: conference.id })

  const result = ingestCsv(csv)
  const counts = await persist(db, conference.slug, conference.organization, result.rows)

  await unsafeDb.conferenceIntegration.update({
    where: { id: integration.id },
    data: {
      lastRunAt: new Date(),
      lastResult: {
        created: counts.created,
        duplicates: counts.duplicates,
        skipped: result.skipped.length,
        ignoredPlacementColumns: result.ignoredPlacementColumns,
      },
    },
  })

  return summarise(result, counts)
}

/**
 * The Apps Script an organiser pastes into their own sheet.
 *
 * Generated with the URL and secret already filled in, because the alternative
 * is a documentation page with two placeholders and a support thread for every
 * organiser who pastes one into the wrong quote.
 *
 * One-way and CSV-shaped on purpose. Two-way sync would mean Workspace OAuth,
 * scope review, refresh-token storage and a Google verification process
 * measured in weeks, to solve a problem a webhook already solves.
 */
export function generateAppsScript(webhookUrl: string, secret: string): string {
  return `/**
 * Sends new form responses to ${new URL(webhookUrl).host}.
 *
 * Paste this into your Google Sheet: Extensions -> Apps Script, replace
 * everything, Save, then Triggers -> Add Trigger -> onFormSubmit, From
 * spreadsheet, On form submit.
 *
 * Keep this secret private. Anyone holding it can add registrations to this
 * conference. Reissue it from the conference settings if it leaks.
 */
var WEBHOOK_URL = ${JSON.stringify(webhookUrl)};
var WEBHOOK_SECRET = ${JSON.stringify(secret)};

function onFormSubmit(e) {
  var sheet = e.range.getSheet();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = e.range.getValues()[0];
  sendRows([headers, row]);
}

/** Run this once by hand to send everything already in the sheet. */
function sendAll() {
  var sheet = SpreadsheetApp.getActiveSheet();
  sendRows(sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues());
}

function sendRows(rows) {
  var csv = rows.map(function (row) {
    return row.map(function (cell) {
      var value = cell === null || cell === undefined ? '' : String(cell);
      return '"' + value.replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\\n');

  var response = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ csv: csv }),
    headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    // Surfaces in Apps Script's execution log rather than failing silently.
    throw new Error('Registration sync failed: ' + response.getContentText());
  }
}
`
}
