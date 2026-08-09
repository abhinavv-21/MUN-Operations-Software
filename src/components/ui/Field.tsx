'use client'

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
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
    return (
      <select ref={ref} className={cn(CONTROL, 'appearance-none py-2 pr-8', className)} {...props}>
        {children}
      </select>
    )
  },
)
