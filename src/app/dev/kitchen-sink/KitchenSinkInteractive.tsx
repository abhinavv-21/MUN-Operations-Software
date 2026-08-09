'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { Card, CardHeader } from '@/components/ui/Card.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { Modal } from '@/components/ui/Modal.tsx'

/** The parts of the kit that need state, kept out of the server page. */
export function KitchenSinkInteractive() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Card>
        <CardHeader
          title="Fields"
          description="Every input keeps a persistent label. A placeholder is not a label."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Delegate name" required>
            {({ id }) => <Input id={id} placeholder="Priya Sharma" />}
          </Field>

          <Field label="Email address" hint="Used for the allocation email only">
            {({ id, describedBy }) => (
              <Input id={id} type="email" aria-describedby={describedBy} />
            )}
          </Field>

          <Field label="Committee">
            {({ id }) => (
              <Select id={id}>
                <option>UNSC</option>
                <option>WHO</option>
                <option>DISEC</option>
              </Select>
            )}
          </Field>

          <Field label="Country" error="That country is already allocated in this committee">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value="France" readOnly />
            )}
          </Field>

          <Field label="Disabled">{({ id }) => <Input id={id} disabled value="Locked" />}</Field>

          <Field label="Notes">{({ id }) => <Textarea id={id} placeholder="Anything the chair should know" />}</Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Modal"
          description="Bottom sheet on mobile, centred from md up. Ignores stray outside clicks when it holds input."
        />
        <Button onClick={() => setOpen(true)}>Open modal</Button>

        <Modal
          open={open}
          onOpenChange={setOpen}
          title="Import a country matrix"
          description="Committee and country columns are read. Placement columns are reported and ignored."
          holdsInput
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Import</Button>
            </>
          }
        >
          <Field label="Paste CSV">{({ id }) => <Textarea id={id} rows={6} />}</Field>
        </Modal>
      </Card>
    </>
  )
}
