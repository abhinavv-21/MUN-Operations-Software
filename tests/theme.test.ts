import { describe, expect, it } from 'vitest'
import { buildThemeVars, contrastPairs, serializeVars, GROUNDS } from '../src/lib/theme/build.ts'
import { colorDifference, contrastRatio, ensureContrast } from '../src/lib/theme/contrast.ts'
import { parseTheme, PRESET_SEEDS, themeSchema } from '../src/lib/theme/schema.ts'

/**
 * The contrast contract, enforced.
 *
 * The reference product keeps eleven measured pairs in a comment. That is
 * accurate for exactly one brand: the moment an organiser picks their own
 * colour, every number in it is a guess. These run the real derivation over
 * hostile input and check every pair the ground classes publish.
 *
 * No database, so this runs anywhere.
 */

const SEEDS: { name: string; seed: Record<string, string> }[] = [
  { name: 'the reference magenta', seed: PRESET_SEEDS.magenta as unknown as Record<string, string> },
  { name: 'navy', seed: PRESET_SEEDS.navy as unknown as Record<string, string> },
  { name: 'forest', seed: PRESET_SEEDS.forest as unknown as Record<string, string> },
  {
    // The one that breaks naive derivation. A pale yellow is nearly the
    // lightness of the paper it sits on, so anything that only tweaks
    // saturation leaves text at about 1.2:1.
    name: 'a deliberately awful pale yellow',
    seed: { primary: '#f5e663', ink: '#2b2a1f', paper: '#fffdf0', accent: '#f7f3c0' },
  },
  {
    // The opposite failure: a brand so dark it disappears into the ink.
    name: 'near-black brand on near-white paper',
    seed: { primary: '#0a0a0a', ink: '#111111', paper: '#ffffff', accent: '#222222' },
  },
  {
    // Mid-grey against mid-grey, where no amount of walking one hue helps and
    // the derivation has to fall back to a pole.
    name: 'mid-grey on mid-grey',
    seed: { primary: '#808080', ink: '#7a7a7a', paper: '#8a8a8a', accent: '#909090' },
  },
]

describe('the contrast contract', () => {
  for (const { name, seed } of SEEDS) {
    it(`holds every pair for ${name}`, () => {
      const vars = buildThemeVars(themeSchema.parse({ seed }))
      const failures = contrastPairs(vars)
        .filter((pair) => pair.ratio < pair.minimum)
        .map((pair) => `${pair.name}: ${pair.ratio.toFixed(2)}:1 (needs ${pair.minimum}:1)`)

      expect(failures, failures.join('\n')).toEqual([])
    })
  }

  it('leaves a colour alone when it already passes', () => {
    // A well-chosen palette should come through exactly as the organiser set
    // it. Nudging colours that were already fine is how a brand slowly stops
    // looking like itself.
    const untouched = ensureContrast({ color: '#1a0715', against: '#ffffff', ratio: 4.5 })
    expect(untouched).toBe('#1a0715')
  })

  it('walks lighter on a dark ground and darker on a light one', () => {
    const onDark = ensureContrast({ color: '#333333', against: '#111111' })
    const onLight = ensureContrast({ color: '#cccccc', against: '#ffffff' })

    expect(contrastRatio(onDark, '#111111')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(onLight, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('token derivation', () => {
  it('publishes every token name the ported components use', () => {
    const vars = buildThemeVars(themeSchema.parse({}))

    // The names are the migration contract. The reference product's feature
    // folders use these exact classes and contain no hex anywhere, so they port
    // with zero colour edits — as long as nothing here is renamed.
    for (const token of [
      'canvas',
      'surface',
      'surface-sunken',
      'surface-inverted',
      'ink',
      'ink-secondary',
      'ink-tertiary',
      'ink-inverted',
      'accent',
      'accent-hover',
      'accent-pressed',
      'accent-wash',
      'accent-bright',
      'success',
      'success-wash',
      'warning',
      'warning-wash',
      'danger',
      'danger-wash',
      'info',
      'info-wash',
      'edge',
      'edge-strong',
      'focus',
    ]) {
      expect(vars[token], `missing token: ${token}`).toBeTruthy()
    }
  })

  it('publishes the seven locals for every ground', () => {
    const vars = buildThemeVars(themeSchema.parse({}))

    for (const ground of GROUNDS) {
      for (const local of ['ground', 'on', 'on-<g>-muted', 'hairline', 'focus', 'accent-on', 'border']) {
        const token =
          local === 'ground'
            ? `ground-${ground}`
            : local === 'on'
              ? `on-${ground}`
              : local === 'on-<g>-muted'
                ? `on-${ground}-muted`
                : local === 'accent-on'
                  ? `accent-on-${ground}`
                  : `${local}-${ground}`
        expect(vars[token], `missing ${token}`).toBeTruthy()
      }
    }
  })

  it('keeps focus visibly distinct from the brand, even when the brand is blue', () => {
    // A focus ring the same colour as the accent is indistinguishable from a
    // hover state, which defeats the point of having one.
    //
    // Measured as colour difference, not contrast ratio. Two colours can be
    // opposite on the wheel and identical in luminance, which reads as 1.1:1
    // and is plainly two different colours to look at.
    for (const primary of ['#1d4ed8', '#b41884', '#166534']) {
      const vars = buildThemeVars(themeSchema.parse({ seed: { primary } }))
      expect(colorDifference(vars.focus!, vars.accent!), primary).toBeGreaterThan(0.1)
    }
  })

  it('serialises into declarations a browser will accept', () => {
    const css = serializeVars(buildThemeVars(themeSchema.parse({})))

    expect(css).toContain('--t-accent:')
    expect(css).not.toContain('undefined')
    // Nothing here may close the style element it is written into.
    expect(css).not.toMatch(/[<>]/)
  })
})

describe('the theme schema', () => {
  it('falls back to the default theme rather than throwing on a bad row', () => {
    // theme is a JSON column. A hand-edited row must degrade to something
    // renderable, not take the page down.
    expect(parseTheme({ preset: 'not-a-preset', seed: { primary: 'blurple' } }).preset).toBe('magenta')
    expect(parseTheme(null).seed.primary).toBe('#b41884')
  })

  it('refuses anything that is not a hex colour', () => {
    // The gate against CSS injection: no url(), no expressions, no
    // var(--something-else), just six hex digits.
    for (const bad of ['red', 'rgb(1,2,3)', 'var(--x)', 'url(javascript:alert(1))', '#12345']) {
      expect(themeSchema.safeParse({ seed: { primary: bad } }).success, bad).toBe(false)
    }
  })

  it('keeps an organiser override when a preset is applied', () => {
    const theme = themeSchema.parse({ preset: 'forest', seed: { primary: '#123456' } })
    const vars = buildThemeVars(theme)
    // Choosing a preset is a starting point, not a reset of what you already set.
    expect(vars.accent).toBe('#123456')
  })
})
