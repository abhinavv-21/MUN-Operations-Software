import { converter, formatHex, parse, type Oklch } from 'culori'
import { contrastRatio, ensureContrast, TEXT_CONTRAST, UI_CONTRAST } from './contrast.ts'
import { withPreset, type Theme, type ThemeInput } from './schema.ts'

/**
 * Expands four seed colours into the full token set.
 *
 * The token *names* are the migration contract — `canvas`, `surface.sunken`,
 * `ink.secondary`, `accent.hover`, `edge.strong` and the rest are exactly the
 * names the reference product's thirteen feature folders already use, so those
 * screens port with no colour edits at all. What changes is where the values
 * come from: a row in the database rather than a hex literal in a config file.
 *
 * Derivation happens in OKLCH because it is perceptually uniform. Taking 0.06
 * off the lightness of a yellow and of a navy produces a similar *perceived*
 * step; doing the same in HSL darkens one and barely touches the other.
 *
 * Every pair that carries text is walked through `ensureContrast` before it is
 * published. That is the part the reference says to do differently, and it is
 * why an organiser can pick a pale yellow and still get a legible product.
 */

const toOklch = converter('oklch')

interface Lch {
  l: number
  c: number
  h: number
}

function read(color: string): Lch {
  const value = toOklch(parse(color)) as Oklch | undefined
  return { l: value?.l ?? 0.5, c: value?.c ?? 0, h: value?.h ?? 0 }
}

function hex({ l, c, h }: Lch): string {
  return formatHex({ mode: 'oklch', l: clamp(l, 0, 1), c: Math.max(0, c), h }) ?? '#000000'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Lighter or darker by a perceptual step, keeping the hue. */
function shift(color: Lch, deltaL: number, chromaScale = 1): Lch {
  return { ...color, l: clamp(color.l + deltaL, 0, 1), c: color.c * chromaScale }
}

/** A very pale tint of a colour — the `wash` tokens. */
function wash(color: Lch, lightness = 0.97): Lch {
  return { l: lightness, c: Math.min(color.c, 0.045), h: color.h }
}

/** Angular distance between two hues, 0–180. */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(((a - b) % 360) + 360) % 360
  return raw > 180 ? 360 - raw : raw
}

/**
 * The grounds, and what each is built on.
 *
 * Every ground republishes the same seven locals, so a section reads
 * `--on-ground` and never a literal. That is the whole trick: the reference's
 * hardcoded text colour on a plum ground was 1.02:1, and the ground class is
 * what makes writing that impossible.
 */
export const GROUNDS = ['app', 'paper', 'ink', 'blush', 'brand'] as const
export type Ground = (typeof GROUNDS)[number]

export interface ThemeVars {
  [token: string]: string
}

const RADIUS: Record<Theme['radius'], { control: string; card: string }> = {
  sharp: { control: '2px', card: '4px' },
  soft: { control: '6px', card: '10px' },
  round: { control: '10px', card: '18px' },
}

const FONT: Record<Theme['font'], { heading: string; body: string }> = {
  grotesk: { heading: 'var(--font-space-grotesk)', body: 'var(--font-inter)' },
  humanist: { heading: 'var(--font-inter)', body: 'var(--font-inter)' },
  serif: {
    heading: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    body: 'var(--font-inter)',
  },
}

export function buildThemeVars(input: ThemeInput): ThemeVars {
  const theme = withPreset(input)

  const primary = read(theme.seed.primary)
  const ink = read(theme.seed.ink)
  const paper = read(theme.seed.paper)
  const gold = read(theme.seed.accent)

  // ---- Surfaces -----------------------------------------------------------
  const canvas = hex(paper)
  // Always a visible step above the canvas, never merely "at least this light".
  // Clamping to a floor let a paper that was already near-white produce a
  // surface identical to the canvas, and a card with no edge against the page
  // it sits on is not a card.
  const surface = hex({
    ...paper,
    l: Math.min(1, Math.max(paper.l + 0.02, 0.99)),
    c: Math.min(paper.c, 0.005),
  })
  const surfaceSunken = hex(shift(paper, -0.035))
  // One step up from ink, for cards sitting on the dark ground.
  const surfaceInverted = hex(shift(ink, 0.06, 1.1))

  // ---- Text ---------------------------------------------------------------
  // Held against both light grounds in turn. `text-ink` appears on `surface`
  // and on `canvas`, and those are different colours — a seed that clears one
  // and fails the other is the case a single check would miss.
  const inkBase = ensureContrast({
    color: ensureContrast({ color: hex(ink), against: surface, ratio: TEXT_CONTRAST }),
    against: canvas,
    ratio: TEXT_CONTRAST,
  })
  const inkSecondary = ensureContrast({
    color: hex(shift(ink, 0.28, 0.5)),
    against: surface,
    ratio: TEXT_CONTRAST,
  })
  // Tertiary is placeholder and disabled text. WCAG exempts disabled controls,
  // but a placeholder nobody can read is still a broken form, so it is held to
  // the UI threshold rather than to nothing.
  const inkTertiary = ensureContrast({
    color: hex(shift(ink, 0.5, 0.3)),
    against: surface,
    ratio: UI_CONTRAST,
  })
  // Text on the dark ground. Walked lighter, because a seed whose ink is
  // already mid-grey produces a "dark" ground that is not dark at all.
  const inkInverted = ensureContrast({
    color: hex({ l: 0.97, c: Math.min(primary.c, 0.02), h: primary.h }),
    against: surfaceInverted,
    ratio: TEXT_CONTRAST,
    direction: 'lighter',
  })

  // ---- Accent -------------------------------------------------------------
  /*
    Held to text contrast on **two** backgrounds, not one.

    `text-accent` is a real class rather than only a fill, and it appears on the
    surface *and* on `accent-wash` — the active sidebar item, the active tab, the
    allocated cells of the matrix on the landing page. The wash is a tint of the
    accent itself and sits a couple of points lighter than the surface, so a
    guarantee against the surface did not carry: two of the six seeds the theme
    suite tries reached only 4.30:1 there.

    So the wash is derived first, from a provisional accent, and the accent is
    then held against whichever of the two is the harder background. Only
    darkening is ever needed, and darkening against the wash cannot hurt the
    surface, which is lighter still.
  */
  const provisionalAccent = ensureContrast({
    color: hex(primary),
    against: surface,
    ratio: TEXT_CONTRAST,
  })
  const accentWash = hex(wash(read(provisionalAccent)))
  const accent = ensureContrast({
    color: provisionalAccent,
    against: accentWash,
    ratio: TEXT_CONTRAST,
  })
  const accentLch = read(accent)
  const accentHover = hex(shift(accentLch, -0.05))
  const accentPressed = hex(shift(accentLch, -0.1))
  // The reference needed this for exactly one reason: its magenta reaches only
  // 2.9:1 on the plum ground, so a lighter cut is required wherever the accent
  // has to carry meaning on dark.
  const accentBright = ensureContrast({
    color: hex(shift(accentLch, 0.2)),
    against: surfaceInverted,
    ratio: TEXT_CONTRAST,
    direction: 'lighter',
  })

  // ---- Edges and focus ----------------------------------------------------
  // Hairlines are tinted with the brand rather than left neutral grey, so they
  // sit inside the palette instead of beside it.
  const edge = hex({ l: clamp(paper.l - 0.08, 0, 1), c: Math.min(primary.c * 0.12, 0.02), h: primary.h })
  const edgeStrong = ensureContrast({
    color: hex({ l: clamp(paper.l - 0.2, 0, 1), c: Math.min(primary.c * 0.16, 0.03), h: primary.h }),
    against: surface,
    ratio: UI_CONTRAST,
  })

  // Focus is deliberately not the brand colour — a focus ring that matches the
  // accent is indistinguishable from a hover state. Blue by default, moved to
  // the opposite side of the wheel when the brand is itself blue.
  const BLUE_HUE = 264
  const focusHue = hueDistance(primary.h, BLUE_HUE) < 40 ? (primary.h + 180) % 360 : BLUE_HUE
  const focus = ensureContrast({
    color: hex({ l: 0.5, c: 0.19, h: focusHue }),
    against: surface,
    ratio: UI_CONTRAST,
  })

  // ---- Semantic -----------------------------------------------------------
  // Fixed hues, because green-means-good is not a brand decision. Only their
  // lightness adapts, so they stay legible on whatever paper was chosen.
  const semantic = (hue: number, chroma: number) => {
    const base = ensureContrast({
      color: hex({ l: 0.5, c: chroma, h: hue }),
      against: surface,
      ratio: TEXT_CONTRAST,
    })
    const washed = hex(wash(read(base), 0.965))
    return {
      base: ensureContrast({ color: base, against: washed, ratio: TEXT_CONTRAST }),
      wash: washed,
    }
  }

  const success = semantic(150, 0.13)
  const warning = semantic(70, 0.14)
  const danger = semantic(27, 0.16)
  const info = semantic(BLUE_HUE, 0.15)

  // ---- Grounds ------------------------------------------------------------
  const groundBase: Record<Ground, string> = {
    app: canvas,
    paper: surface,
    ink: hex(ink),
    blush: accentWash,
    brand: accentPressed,
  }

  const groundVars: ThemeVars = {}

  for (const ground of GROUNDS) {
    const base = groundBase[ground]
    const isDark = read(base).l < 0.5

    const onGround = ensureContrast({
      color: isDark ? inkInverted : inkBase,
      against: base,
      ratio: TEXT_CONTRAST,
    })

    // Muted text is still text. Derived by stepping back toward the ground and
    // then walked forward again until it passes — not by dropping opacity and
    // hoping, which is how the reference's plum ground reached 1.02:1.
    const onGroundMuted = ensureContrast({
      color: hex(shift(read(onGround), isDark ? -0.18 : 0.22, 0.7)),
      against: base,
      ratio: TEXT_CONTRAST,
    })

    // On a brand-coloured ground the accent *is* the ground, so it cannot also
    // be the thing drawn on top of it. The readable text colour stands in.
    const accentCandidate =
      ground === 'brand' ? onGround : isDark ? accentBright : accent

    groundVars[`ground-${ground}`] = base
    groundVars[`on-${ground}`] = onGround
    groundVars[`on-${ground}-muted`] = onGroundMuted
    groundVars[`hairline-${ground}`] = hex(shift(read(base), isDark ? 0.12 : -0.07, 0.6))
    groundVars[`focus-${ground}`] = ensureContrast({
      color: isDark ? hex({ l: 0.8, c: 0.14, h: focusHue }) : focus,
      against: base,
      ratio: UI_CONTRAST,
    })
    groundVars[`accent-on-${ground}`] = ensureContrast({
      color: accentCandidate,
      against: base,
      ratio: TEXT_CONTRAST,
    })
    // An interactive edge is a UI component, not decoration: 3:1, not 1.2:1.
    groundVars[`border-${ground}`] = ensureContrast({
      color: accentCandidate,
      against: base,
      ratio: UI_CONTRAST,
    })
  }

  return {
    canvas,
    surface,
    'surface-sunken': surfaceSunken,
    'surface-inverted': surfaceInverted,

    ink: inkBase,
    'ink-secondary': inkSecondary,
    'ink-tertiary': inkTertiary,
    'ink-inverted': inkInverted,

    accent,
    'accent-hover': accentHover,
    'accent-pressed': accentPressed,
    'accent-wash': accentWash,
    'accent-bright': accentBright,

    gold: hex(gold),

    success: success.base,
    'success-wash': success.wash,
    warning: warning.base,
    'warning-wash': warning.wash,
    danger: danger.base,
    'danger-wash': danger.wash,
    info: info.base,
    'info-wash': info.wash,

    edge,
    'edge-strong': edgeStrong,
    focus,

    ...groundVars,

    'radius-control': RADIUS[theme.radius].control,
    'radius-card': RADIUS[theme.radius].card,
    'font-heading': FONT[theme.font].heading,
    'font-body': FONT[theme.font].body,
  }
}

/**
 * Every pair the tests check.
 *
 * Kept beside the derivation rather than in the test file, so adding a token
 * that carries text and forgetting to check it is a visible omission here
 * rather than an invisible one over there.
 */
export function contrastPairs(vars: ThemeVars) {
  const pairs: { name: string; ratio: number; minimum: number }[] = []
  const add = (name: string, fg: string, bg: string, minimum: number) =>
    pairs.push({ name, ratio: contrastRatio(fg, bg), minimum })

  add('ink on surface', vars.ink!, vars.surface!, TEXT_CONTRAST)
  add('ink-secondary on surface', vars['ink-secondary']!, vars.surface!, TEXT_CONTRAST)
  add('ink-tertiary on surface', vars['ink-tertiary']!, vars.surface!, UI_CONTRAST)
  add('ink on canvas', vars.ink!, vars.canvas!, TEXT_CONTRAST)
  add('accent on surface', vars.accent!, vars.surface!, TEXT_CONTRAST)
  /*
    `bg-accent-wash text-accent` is real, load-bearing code — the active item in
    the sidebar, the active tab lozenge, the matrix's allocated cells — and it
    was the one pair nothing checked. `accent` is only guaranteed against
    `surface`, and the wash is a couple of points lighter than that, so the
    guarantee did not carry across.
  */
  add('accent on accent-wash', vars.accent!, vars['accent-wash']!, TEXT_CONTRAST)
  add('accent-bright on surface-inverted', vars['accent-bright']!, vars['surface-inverted']!, TEXT_CONTRAST)
  add('ink-inverted on surface-inverted', vars['ink-inverted']!, vars['surface-inverted']!, TEXT_CONTRAST)
  add('edge-strong on surface', vars['edge-strong']!, vars.surface!, UI_CONTRAST)
  add('focus on surface', vars.focus!, vars.surface!, UI_CONTRAST)

  for (const tone of ['success', 'warning', 'danger', 'info'] as const) {
    add(`${tone} on ${tone}-wash`, vars[tone]!, vars[`${tone}-wash`]!, TEXT_CONTRAST)
    add(`${tone} on surface`, vars[tone]!, vars.surface!, TEXT_CONTRAST)
  }

  for (const ground of GROUNDS) {
    const base = vars[`ground-${ground}`]!
    add(`on-${ground}`, vars[`on-${ground}`]!, base, TEXT_CONTRAST)
    add(`on-${ground}-muted`, vars[`on-${ground}-muted`]!, base, TEXT_CONTRAST)
    add(`accent-on-${ground}`, vars[`accent-on-${ground}`]!, base, TEXT_CONTRAST)
    add(`border-${ground}`, vars[`border-${ground}`]!, base, UI_CONTRAST)
    add(`focus-${ground}`, vars[`focus-${ground}`]!, base, UI_CONTRAST)
  }

  return pairs
}

/** Serialises the token map into the declarations of a `:root` block. */
export function serializeVars(vars: ThemeVars): string {
  return Object.entries(vars)
    .map(([token, value]) => `--t-${token}:${value}`)
    .join(';')
}
