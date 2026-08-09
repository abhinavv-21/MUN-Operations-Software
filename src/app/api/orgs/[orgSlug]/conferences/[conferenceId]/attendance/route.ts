import { json, withApi } from '@/server/api.ts'
import { parseJsonBody, parseSearchParams } from '@/server/validate.ts'
import {
  attendanceFiltersSchema,
  attendanceSummary,
  checkIn,
  checkInSchema,
  listAttendance,
} from '@/server/services/attendance.ts'

type Params = { orgSlug: string; conferenceId: string }

export const GET = withApi<Params>(
  async ({ request, ctx }) => {
    const filters = parseSearchParams(new URL(request.url), attendanceFiltersSchema)
    const [delegates, summary] = await Promise.all([
      listAttendance(ctx, filters),
      attendanceSummary(ctx, filters.day),
    ])
    return json({ delegates, summary })
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId' },
)

/**
 * One of the two writes the offline queue may hold.
 *
 * Answers 200 rather than 201 even when it creates the row, because the caller
 * cannot rely on which of the two happened: the queue replays this, and a
 * replay finds the existing mark. `changed` and `created` in the body say what
 * actually occurred for a client that cares.
 */
export const POST = withApi<Params>(
  async ({ request, ctx }) => {
    const input = await parseJsonBody(request, checkInSchema)
    return json(await checkIn(ctx, input))
  },
  { orgParam: 'orgSlug', conferenceParam: 'conferenceId', audit: 'attendance.checkin' },
)
