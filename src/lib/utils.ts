import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge, taught our scale.
 *
 * This is not configuration for its own sake. Out of the box, tailwind-merge
 * assumes `text-<something>` is a colour unless the something is a known font
 * size — and our sizes are named (`text-body`, `text-h1`, `text-label`), not
 * numeric. So it read `text-body` as a colour, decided it conflicted with
 * `text-ink-inverted` in the same call, and kept only the last one.
 *
 * The visible result was every primary button rendering with default dark text
 * on the accent fill instead of the inverted text colour, and every secondary
 * button losing `text-ink`. It looks like a styling nit and is a contrast
 * failure: the whole point of deriving `ink-inverted` is that it is legible on
 * the accent, and it was being thrown away before it reached the DOM.
 *
 * Registering the named scales is what makes `cn` safe to use with our tokens.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body', 'body-sm', 'label', 'data'] }],
      rounded: [{ rounded: ['control', 'card', 'pill'] }],
      shadow: [{ shadow: ['raised', 'overlay'] }],
    },
  },
})

/**
 * Conditional classes, with later Tailwind utilities winning over earlier ones.
 *
 * Without the merge, `cn('p-5', className)` and a caller passing `p-2` produce
 * both rules and let source order in the stylesheet decide, which is not what
 * anyone writing the call site expects.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
