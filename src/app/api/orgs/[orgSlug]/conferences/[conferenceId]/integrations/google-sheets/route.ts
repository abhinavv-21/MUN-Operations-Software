import { json, withApi } from '@/server/api.ts'
import { generateAppsScript, issueSheetsSecret } from '@/server/services/ingest.ts'

type Params = { orgSlug: string; conferenceId: string }

/**
 * Issues a webhook secret and returns the Apps Script with it already baked in.
 *
 * POST rather than GET because it mints a credential: the plaintext exists only
 * in this response and in whatever the organiser pastes into their sheet.
 * Calling it again reissues, which is also how a leaked secret is revoked.
 */
export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const { secret, webhookUrl } = await issueSheetsSecret(ctx, new URL(request.url).origin)
    return json({ webhookUrl, secret, appsScript: generateAppsScript(webhookUrl, secret) }, 201)
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'integration.issue_secret' },
)
