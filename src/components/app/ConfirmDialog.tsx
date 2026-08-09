'use client'

import { useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { Field, Input } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { ErrorState } from '@/components/ui/States.tsx'

/**
 * One dialog for "are you sure", used by every irreversible action in the app.
 *
 * The product already had a typed-confirmation danger zone for deleting a
 * conference and for transferring ownership, and **nothing at all** for
 * deleting a committee — which cascades its entire country matrix — or for
 * removing an allocation, which frees the country for somebody else to take
 * within seconds. All four were a single tap on an icon button sitting four
 * pixels from another icon button, with no busy state, so a double tap sent two
 * requests.
 *
 * Two levels, because not every irreversible thing deserves the same friction:
 *
 * - **plain** — a sentence and a red button. For anything a person could redo by
 *   hand in under a minute, like re-adding an allocation.
 * - **typed** — the plain dialog plus the object's own name, typed back. For
 *   anything that takes something else with it. `confirmPhrase` is what must be
 *   typed.
 *
 * The error is rendered *inside* the dialog. The rest of the app renders
 * `ErrorState` at the top of the page body with no z-index, and `Modal` portals
 * its panel at `z-50` — so a failed destructive action left the dialog open, the
 * spinner gone, and the explanation underneath a dimmed backdrop.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequence,
  confirmLabel,
  confirmPhrase,
  error,
  busy = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** One sentence, in the interface's voice, saying what is about to happen. */
  description: string
  /** What goes with it. Omitted when nothing else is affected. */
  consequence?: ReactNode
  /** Names the action, and must match the control that opened this. */
  confirmLabel: string
  /** When set, the exact text that has to be typed before the button enables. */
  confirmPhrase?: string
  error?: string | null
  busy?: boolean
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')

  const satisfied = confirmPhrase === undefined || typed === confirmPhrase

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setTyped('')
      }}
      title={title}
      // A dialog someone types into must not close on a stray backdrop click.
      holdsInput={confirmPhrase !== undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            // Guarded here and re-checked on the server wherever the service
            // supports it: a disabled button is a suggestion that `curl`
            // ignores.
            disabled={!satisfied}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <ErrorState title="That did not work" message={error} /> : null}

        <div className="flex items-start gap-3 rounded-card border border-danger bg-danger-wash p-4">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 text-body-sm text-ink">
            <p>{description}</p>
            {consequence ? <p className="mt-1 text-ink-secondary">{consequence}</p> : null}
          </div>
        </div>

        {confirmPhrase !== undefined ? (
          <Field label={`Type “${confirmPhrase}” to confirm`} required>
            {({ id }) => (
              <Input
                id={id}
                value={typed}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setTyped(event.target.value)}
              />
            )}
          </Field>
        ) : null}
      </div>
    </Modal>
  )
}
