import { describe, expect, it } from 'vitest'
import { cn } from '../src/lib/utils.ts'

/**
 * `cn` is the one piece of the UI kit that can silently discard a class.
 *
 * Everything else in the kit is markup, and markup that is wrong is visible.
 * A class merger that drops the wrong one produces a page that renders, looks
 * almost right, and quietly fails contrast.
 */
describe('class merging', () => {
  it('keeps a text colour and a named text size together', () => {
    // The regression: tailwind-merge treats `text-<x>` as a colour unless it
    // knows `<x>` is a font size. Our sizes are named, so `text-body` was read
    // as a colour and `text-ink-inverted` was dropped — leaving every primary
    // button with default dark text on the accent fill.
    const result = cn('bg-accent text-ink-inverted', 'text-body')

    expect(result).toContain('text-ink-inverted')
    expect(result).toContain('text-body')
  })

  it('still lets a later colour win over an earlier one', () => {
    expect(cn('text-ink', 'text-accent')).toBe('text-accent')
  })

  it('still lets a later size win over an earlier one', () => {
    expect(cn('text-body', 'text-h1')).toBe('text-h1')
  })

  it('keeps modifier variants beside their base class', () => {
    const result = cn('text-ink-inverted disabled:text-ink-tertiary')

    expect(result).toContain('text-ink-inverted')
    expect(result).toContain('disabled:text-ink-tertiary')
  })

  it('resolves the named radius and shadow scales', () => {
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card')
    expect(cn('shadow-raised', 'shadow-overlay')).toBe('shadow-overlay')
  })

  it('lets a caller override padding, which is why the merge exists', () => {
    expect(cn('p-5 md:p-6', 'p-0 md:p-0')).toBe('p-0 md:p-0')
  })
})
