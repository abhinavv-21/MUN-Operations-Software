import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/PageHeader.tsx'
import { pageCtx } from '@/server/page-ctx.ts'
import { AttendanceClient } from './AttendanceClient.tsx'

export const metadata: Metadata = { title: 'Attendance' }

type Params = { orgSlug: string; conferenceId: string }

/**
 * Open to CONTRIBUTOR as well as ADMIN.
 *
 * Manning the desk is the reason the CONTRIBUTOR role exists — the logistics
 * head and the registration volunteers are the people doing this, and none of
 * them should need an organisation admin grant to mark someone present.
 */
export default async function AttendancePage({ params }: { params: Promise<Params> }) {
  const { orgSlug, conferenceId } = await params
  await pageCtx({ organizationSlug: orgSlug, conferenceId })

  return (
    <>
      <PageHeader
        title="Attendance"
        description="One mark per delegate per day. This screen keeps working without a connection."
      />
      <AttendanceClient orgSlug={orgSlug} conferenceId={conferenceId} />
    </>
  )
}
