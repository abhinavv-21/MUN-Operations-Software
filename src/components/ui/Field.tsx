'use client'

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

const CONTROL = cn(
  'w-full rounded-control border border-edge-strong bg-surface px-3',
  'min-h-tap md:min-h-10 text-body text-ink',
  'transition-colors duration-micro ease-standard',
  'hover:border-ink-tertiary',
  'disabled:bg-surface-sunken disabled:text-ink-tertiary disabled:cursor-not-allowed',
  'aria-[invalid=true]:border-danger',
)

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/**
 * Every input keeps a persistent label.
 *
 * A placeholder is not a label: it disappears the moment someone starts typing,
 * which is exactly when they most need to know what the field was for.
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label uppercase text-ink-secondary">
        {label}
        {required ? (
          <span className="ml-1 text-accent" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-body-sm text-ink-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, 'py-2', className)} {...props} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(CONTROL, 'resize-y py-2.5 leading-relaxed', className)}
        {...props}
      />
    )
  },
)

/**
 * A native select.
 *
 * Rich triggers get a Radix Select; plain option lists do not need one. The
 * native control is more accessible on mobile, opens as the platform picker
 * people already know, and works with no JavaScript at all.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    /*
      `appearance-none` removes the platform arrow, so one has to be put back.

      Without it a select is pixel-identical to a text input: on the attendance
      and audit screens the committee and action filters read as empty boxes
      somebody forgot to type into, and nothing suggests they can be opened. The
      chevron is `pointer-events-none` so clicking it still opens the select,
      and it sits in the padding `pr-9` reserves rather than over the text.
    */
    return (
      // The caller's className goes on the wrapper, not the control: every
      // className passed to a Select in this codebase is a width, and a width
      // on the inner element leaves the wrapper stretching the flex row it sits
      // in while the control shrinks inside it.
      <div className={cn('relative w-full', className)}>
        <select ref={ref} className={cn(CONTROL, 'appearance-none py-2 pr-9')} {...props}>
          {children}
        </select>
        <ChevronDown
          size={16}
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
        />
      </div>
    )
  },
)
