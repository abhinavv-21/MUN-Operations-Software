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
  /*
    Every seed is optional, and each absent one is filled from the preset by
    `withPreset`. That is the whole mechanism by which choosing a preset does
    anything.

    They used to carry the magenta values as per-field `.default(...)`. Combined
    with `.prefault({})` on the object — which feeds the value through the schema
    rather than handing it back — that meant parsing produced four explicit
    magenta colours whatever preset was named, and `withPreset`, which spreads
    the seed *over* the preset so a genuine override wins, could never apply one.
    `themeSchema.parse({ preset: 'forest' })` returned magenta, silently.

    Nothing in the product noticed because the settings form always sends four
    explicit colours. An API caller sending `{ "preset": "navy" }`, or a row
    edited by hand, got magenta.
  */
  seed: z
    .object({
      /** The brand. Drives accent, hovers, tints, washes and the page rule. */
      primary: hexColor.optional(),
      /** Body text on light grounds, and the dark ground itself. */
      ink: hexColor.optional(),
      /** The light ground. */
      paper: hexColor.optional(),
      /** A second, optional accent. Decorative — never the sole carrier of meaning. */
      accent: hexColor.optional(),
    })
    .prefault({}),
  radius: z.enum(THEME_RADII).default('soft'),
  font: z.enum(THEME_FONTS).default('grotesk'),
  logoUrl: z.url().max(500).nullable().default(null),
})

/** What arrives from a caller: a preset, and any seeds they chose to override. */
export type ThemeInput = z.infer<typeof themeSchema>

/** Four colours, all present. What everything downstream of `withPreset` sees. */
export interface ThemeSeed {
  primary: string
  ink: string
  paper: string
  accent: string
}

/** A theme with its preset applied. The only shape `buildThemeVars` derives from. */
export type Theme = Omit<ThemeInput, 'seed'> & { seed: ThemeSeed }

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

/**
 * Parses whatever is on the row and resolves it, falling back to the default.
 *
 * Always returns a complete theme, so no consumer has to know that a stored row
 * may name a preset and no colours.
 */
export function parseTheme(value: unknown): Theme {
  const parsed = themeSchema.safeParse(value ?? {})
  return withPreset(parsed.success ? parsed.data : themeSchema.parse({}))
}

/**
 * Applies a preset's seeds, keeping any the organiser actually overrode.
 *
 * Field by field rather than by spreading, because the distinction that matters
 * is between "they chose this colour" and "they did not" — and a spread cannot
 * tell an explicit value from a filled-in one. Choosing a preset is a starting
 * point, not a reset.
 *
 * Idempotent: applying it to an already-resolved theme returns the same theme.
 */
export function withPreset(theme: ThemeInput): Theme {
  const preset = PRESET_SEEDS[theme.preset]

  return {
    ...theme,
    seed: {
      primary: theme.seed.primary ?? preset.primary,
      ink: theme.seed.ink ?? preset.ink,
      paper: theme.seed.paper ?? preset.paper,
      accent: theme.seed.accent ?? preset.accent,
    },
  }
}
