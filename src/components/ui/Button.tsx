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
  primary: 'bg-accent text-ink-inverted shadow-raised hover:bg-accent-hover active:bg-accent-pressed',
  secondary:
    'bg-surface text-ink border border-edge-strong shadow-raised hover:bg-surface-sunken active:bg-surface-sunken active:border-ink-tertiary',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-sunken hover:text-ink active:bg-surface-sunken',
  destructive:
    'bg-danger text-ink-inverted shadow-raised hover:brightness-90 active:brightness-80',
}

/**
 * Applied only when the button is genuinely unavailable — never while it is
 * loading.
 *
 * `loading` sets the `disabled` attribute so the action cannot be fired twice,
 * and that used to drag `disabled:bg-surface-sunken` in with it: the moment you
 * pressed Save, the primary button turned grey. Grey is what this product uses
 * to say "you cannot do this", so the one control that was working looked like
 * the one control that had stopped. A loading button keeps its own colour and
 * says so with the spinner and `aria-busy`.
 *
 * The `aria-disabled:` half is for `asChild`. An anchor takes no `disabled`
 * attribute, so the component marks it `aria-disabled` instead — and until now
 * that announced a disabled control that still looked and behaved like a live
 * one.
 */
const DISABLED: Record<Variant, string> = {
  primary:
    'disabled:bg-surface-sunken disabled:text-ink-tertiary disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:bg-surface-sunken aria-disabled:text-ink-tertiary aria-disabled:shadow-none',
  secondary:
    'disabled:bg-surface-sunken disabled:text-ink-tertiary disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:bg-surface-sunken aria-disabled:text-ink-tertiary aria-disabled:shadow-none',
  ghost: 'disabled:text-ink-tertiary aria-disabled:pointer-events-none aria-disabled:text-ink-tertiary',
  destructive:
    'disabled:bg-surface-sunken disabled:text-ink-tertiary disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:bg-surface-sunken aria-disabled:text-ink-tertiary aria-disabled:shadow-none',
}

// 48px minimum on mobile; desktop may tighten to 40px.
const SIZES: Record<Size, string> = {
  md: 'min-h-tap md:min-h-10 px-5 py-3 md:py-2 text-body',
  sm: 'min-h-tap md:min-h-9 px-3.5 py-2 text-body-sm',
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
    'inline-flex select-none items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors duration-micro ease-standard',
    VARIANTS[variant],
    // `disabled:cursor-not-allowed` belongs with the rest of the disabled
    // treatment and not in the base: a loading button carries the `disabled`
    // attribute too, and the crossed-out cursor said "you cannot press this"
    // about a button that was in the middle of doing exactly what was asked.
    loading ? 'cursor-progress' : cn('disabled:cursor-not-allowed', DISABLED[variant]),
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

    So is `type`, and defaulting it to `button` is a correctness fix rather than
    a tidy-up. HTML's default for a `<button>` with no type is `submit`, so every
    Button that happened to sit inside a `<form>` submitted it on click as well
    as running its own `onClick`. On the sign-in screen the ghost control that
    goes back to change your email address sits inside the password form and
    inside the create-account form: clicking it ran the back handler *and* the
    submit — so going back from the password step reported "That password is not
    right." on the email step, and going back from the create-account step
    created the account at the address you had just decided was wrong.

    Every button in this codebase that is meant to submit already says
    `type="submit"` explicitly, including the two that reach across the DOM with
    `form="…"` from a dialog footer, so nothing relied on the implicit default.
    A caller's own `type` still wins: `props` is spread after this.
  */
  return (
    <Component
      ref={ref}
      {...(asChild ? {} : { type: 'button' as const, disabled: disabled || loading })}
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
