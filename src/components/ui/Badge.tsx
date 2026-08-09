import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, CircleDot, Crown, Mail } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONES: Record<Tone, string> = {
  success: 'bg-success-wash text-success border-success/30',
  warning: 'bg-warning-wash text-warning border-warning/30',
  danger: 'bg-danger-wash text-danger border-danger/30',
  info: 'bg-info-wash text-info border-info/30',
  neutral: 'bg-surface-sunken text-ink-secondary border-edge-strong',
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
 */
export function Badge({ tone, icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1',
        'text-label uppercase',
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon size={14} className="shrink-0" aria-hidden /> : null}
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
