import { z } from 'zod'

/**
 * What an organiser is allowed to set.
 *
 * A preset plus four seed colours, not arbitrary CSS. Letting organisers paste
 * CSS would be an XSS surface, and an unmaintainable one: every future change
 * to the token set would break whatever they had written against the old
 * names.
 *
 * Everything else — hovers, pressed states, tints, washes, hairlines, every
 * on-ground pair — is derived by buildThemeVars and checked against the
 * contrast contract before it is published.
 */

const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour like #B41884')
  .transform((value) => value.toLowerCase())

export const THEME_PRESETS = ['magenta', 'navy', 'forest', 'ember', 'slate'] as const
export const THEME_RADII = ['sharp', 'soft', 'round'] as const
export const THEME_FONTS = ['grotesk', 'serif', 'humanist'] as const

export const themeSchema = z.object({
  preset: z.enum(THEME_PRESETS).default('magenta'),
  seed: z
    .object({
      /** The brand. Drives accent, hovers, tints, washes and the page rule. */
      primary: hexColor.default('#b41884'),
      /** Body text on light grounds, and the dark ground itself. */
      ink: hexColor.default('#1a0715'),
      /** The light ground. */
      paper: hexColor.default('#f8fafc'),
      /** A second, optional accent. Decorative — never the sole carrier of meaning. */
      accent: hexColor.default('#d9a441'),
    })
    // `prefault`, not `default`. A default value is handed back as-is without
    // being parsed, so `.default({})` would produce a seed with no colours in
    // it and every derived token would come out `undefined`. `prefault` feeds
    // the value through the schema, so the four field defaults actually apply.
    .prefault({}),
  radius: z.enum(THEME_RADII).default('soft'),
  font: z.enum(THEME_FONTS).default('grotesk'),
  logoUrl: z.url().max(500).nullable().default(null),
})

export type Theme = z.infer<typeof themeSchema>
export type ThemeSeed = Theme['seed']

/** The presets, as seeds. The reference product's magenta is the default. */
export const PRESET_SEEDS: Record<(typeof THEME_PRESETS)[number], ThemeSeed> = {
  // Sampled from the LRI crest and MUN emblem — the same magenta appears in
  // both, which is what made it the genuine brand colour rather than a choice.
  magenta: { primary: '#b41884', ink: '#1a0715', paper: '#f8fafc', accent: '#d9a441' },
  navy: { primary: '#1d4ed8', ink: '#0b1220', paper: '#f8fafc', accent: '#c2872b' },
  forest: { primary: '#166534', ink: '#0a1710', paper: '#f7faf8', accent: '#b45309' },
  ember: { primary: '#c2410c', ink: '#1c0f07', paper: '#fdf9f6', accent: '#0f766e' },
  slate: { primary: '#334155', ink: '#0f172a', paper: '#f8fafc', accent: '#0e7490' },
}

/** Parses whatever is on the row, falling back to the default theme. */
export function parseTheme(value: unknown): Theme {
  const parsed = themeSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : themeSchema.parse({})
}

/**
 * Applies a preset's seeds, keeping any the organiser has overridden.
 * Choosing a preset is a starting point, not a reset.
 */
export function withPreset(theme: Theme): Theme {
  return { ...theme, seed: { ...PRESET_SEEDS[theme.preset], ...theme.seed } }
}
