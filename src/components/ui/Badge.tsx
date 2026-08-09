import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, CircleDot, Crown, Mail } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/**
 * Every tone is a wash, a text colour and an edge at the same weight.
 *
 * Neutral used to take `border-edge-strong` at full strength while the four
 * semantic tones took theirs at 30%, so in a row of badges the one that meant
 * nothing in particular was outlined more heavily than the one that meant
 * "absent". The tones are the only thing that should differ between these.
 */
const TONES: Record<Tone, string> = {
  success: 'bg-success-wash text-success border-success/35',
  warning: 'bg-warning-wash text-warning border-warning/35',
  danger: 'bg-danger-wash text-danger border-danger/35',
  info: 'bg-info-wash text-info border-info/35',
  neutral: 'bg-surface-sunken text-ink-secondary border-edge-strong/45',
}

interface BadgeProps {
  tone: Tone
  icon?: LucideIcon
  children: ReactNode
  className?: string
}

/**
 * Status is never colour alone.
 *
 * Every badge renders an icon and a text label, so it survives greyscale,
 * colour blindness, and a phone held at an angle in a bright corridor — which
 * is the actual environment this product is used in.
 *
 * The height is fixed at 24px rather than left to `py-1` and the line box. A
 * badge sits next to a name, inside a table cell, beside another badge, and
 * padding-derived height made every one of those a slightly different pill —
 * most visibly on the delegates table, where the committee badge and the
 * country beside it never quite shared a centre line.
 */
export function Badge({ tone, icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5',
        'text-label uppercase',
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon size={13} className="-ml-0.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  )
}

const ORG_ROLE: Record<string, { tone: Tone; icon: LucideIcon; label: string }> = {
  OWNER: { tone: 'info', icon: Crown, label: 'Owner' },
  ADMIN: { tone: 'info', icon: CheckCircle2, label: 'Admin' },
  MEMBER: { tone: 'neutral', icon: CircleDot, label: 'Member' },
}

export function RoleBadge({ role }: { role: string }) {
  const config = ORG_ROLE[role] ?? ORG_ROLE.MEMBER!
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {config.label}
    </Badge>
  )
}

export function InvitationBadge({ accepted }: { accepted: boolean }) {
  return accepted ? (
    <Badge tone="success" icon={CheckCircle2}>
      Accepted
    </Badge>
  ) : (
    <Badge tone="warning" icon={Mail}>
      Awaiting reply
    </Badge>
  )
}
