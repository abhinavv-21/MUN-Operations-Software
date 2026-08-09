'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './Button.tsx'
import { cn } from '@/lib/utils.ts'

const OVERLAY = 'fixed inset-0 z-40 bg-surface-inverted/40 backdrop-blur-[1px]'

const PANEL = cn(
  'fixed z-50 flex flex-col gap-4 border border-edge bg-surface shadow-overlay',
  'focus:outline-none',
  // Bottom sheet on mobile, centred dialog from md up. A modal that appears in
  // the middle of a phone screen puts its actions where no thumb reaches.
  'inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-card p-5',
  'md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:p-6',
  'data-[state=open]:animate-slide-up',
)

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  holdsInput = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /**
   * Set this on any dialog a person types into.
   *
   * A dialog closes when you click the page behind it, and forms clear on
   * close — so a mis-aimed click while a two-hundred-row matrix CSV was pasted,
   * or halfway through a delegate's details, threw all of it away with no
   * warning and no way back. A stray click is not a decision to discard, so
   * these dialogs ignore it. Escape, Cancel and the close button are all
   * deliberate and still work.
   */
  holdsInput?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          className={PANEL}
          {...(holdsInput ? { onInteractOutside: (event: Event) => event.preventDefault() } : {})}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="font-heading text-h2 text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 max-w-prose text-body-sm text-ink-secondary">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X size={18} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-w-0">{children}</div>

          {/*
            Stacked and full width on a phone, a right-aligned row from sm up.

            `flex-col-reverse` puts the last child — which is the confirming
            action in every dialog in this product — at the top of the stack,
            under the thumb and above Cancel. The previous `flex-wrap
            justify-end` produced two half-width buttons crowded into the
            bottom-right corner of a bottom sheet, which is the worst place on
            a phone to put the decision.
          */}
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-edge pt-4 sm:flex-row sm:justify-end sm:border-0 sm:pt-0">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
