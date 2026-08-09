import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'md' | 'sm' | 'icon'

/**
 * Plain `Record<Variant, string>` maps, not CVA.
 *
 * Ported from the reference product, which has no component library and no
 * class-variance-authority. Two maps and a `cn` call are readable at a glance
 * and have no configuration to learn.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-ink-inverted hover:bg-accent-hover active:bg-accent-pressed disabled:bg-surface-sunken disabled:text-ink-tertiary',
  secondary:
    'bg-surface text-ink border border-edge-strong hover:bg-surface-sunken disabled:text-ink-tertiary',
  ghost:
    'bg-transparent text-ink-secondary hover:bg-surface-sunken hover:text-ink disabled:text-ink-tertiary',
  destructive:
    'bg-danger text-ink-inverted hover:brightness-110 active:brightness-95 disabled:bg-surface-sunken disabled:text-ink-tertiary',
}

// 48px minimum on mobile; desktop may tighten to 40px.
const SIZES: Record<Size, string> = {
  md: 'min-h-tap md:min-h-10 px-5 py-3 md:py-2 text-body',
  sm: 'min-h-tap md:min-h-9 px-3 py-2 text-body-sm',
  icon: 'size-tap md:size-9 p-0',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    asChild = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : 'button'

  const classes = cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors duration-micro ease-standard',
    'disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    className,
  )

  /*
    The spinner and `children` are passed as two separate children, not wrapped
    in a fragment.

    Slot looks through its own children for a `Slottable` to hand its props to.
    Wrapping them in a fragment first makes Slot see exactly one child — the
    fragment — never find the Slottable inside it, and fall back to treating the
    fragment as the slot target. React drops every prop on a fragment, so the
    className goes nowhere and every `<Button asChild>` renders as unstyled bare
    text. In the reference that was the primary action on four empty states and
    every "View all" link on the dashboard.

    `disabled` is meaningless on the anchors asChild renders, so it is only
    forwarded to a real button.
  */
  return (
    <Component
      ref={ref}
      {...(asChild ? {} : { disabled: disabled || loading })}
      {...(asChild && (disabled || loading) ? { 'aria-disabled': true } : {})}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
      {asChild ? <Slottable>{children}</Slottable> : children}
    </Component>
  )
})
