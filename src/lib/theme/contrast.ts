import { converter, differenceEuclidean, formatHex, parse, type Oklch } from 'culori'

/**
 * The contrast contract, as code.
 *
 * The reference product keeps it as a hand-maintained table in a comment at the
 * top of tokens.css — eleven measured pairs with pass marks. That works for one
 * brand, and its own decision record says so: the moment an organiser picks
 * their own navy, every ratio in that comment is a guess.
 *
 * So it is a function with a test. Nothing derived by buildThemeVars is
 * published until it has been walked into compliance here.
 */

const toOklch = converter('oklch')
const toRgb = converter('rgb')

/** WCAG 2.1 relative luminance. sRGB, not OKLCH — the standard is defined on sRGB. */
function relativeLuminance(color: string): number {
  const rgb = toRgb(parse(color))
  if (!rgb) return 0

  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Body text and any text under 18.66px bold / 24px regular. */
export const TEXT_CONTRAST = 4.5

/**
 * Interactive boundaries and meaningful graphics.
 *
 * The reference learned this the hard way: its default hairline is 1.21:1,
 * which is fine for dividing content and illegal as the only visible edge of a
 * control.
 */
export const UI_CONTRAST = 3

export interface EnsureOptions {
  /** The colour that must remain recognisable. */
  color: string
  /** What it sits on. */
  against: string
  /** 4.5 for text, 3 for interactive edges. */
  ratio?: number
  /**
   * Which way to walk when the colour fails. 'auto' picks whichever direction
   * the ground allows — away from the ground's own lightness.
   */
  direction?: 'auto' | 'lighter' | 'darker'
}

/**
 * Walks a colour's OKLCH lightness until it clears the required ratio.
 *
 * Lightness only. Hue is the organiser's brand and is never touched; chroma is
 * reduced only at the extremes, where high-chroma colours cannot exist in sRGB
 * and would otherwise clip to something unrelated.
 *
 * Returns the original colour untouched when it already passes, so a
 * well-chosen palette comes through exactly as the organiser set it.
 */
export function ensureContrast({
  color,
  against,
  ratio = TEXT_CONTRAST,
  direction = 'auto',
}: EnsureOptions): string {
  if (contrastRatio(color, against) >= ratio) return color

  const base = toOklch(parse(color)) as Oklch | undefined
  if (!base) return color

  const groundLightness = (toOklch(parse(against)) as Oklch | undefined)?.l ?? 0.5

  // Away from the ground. A dark ground needs a lighter colour and there is no
  // amount of darkening that will help.
  const towardsLight = direction === 'auto' ? groundLightness < 0.5 : direction === 'lighter'

  const STEP = 0.02
  let best = color
  let bestRatio = contrastRatio(color, against)

  for (let i = 1; i <= 50; i += 1) {
    const lightness = towardsLight
      ? Math.min(1, (base.l ?? 0) + STEP * i)
      : Math.max(0, (base.l ?? 0) - STEP * i)

    // Chroma cannot survive the extremes of the sRGB gamut. Easing it off near
    // the ends keeps the walk inside colours that actually exist, instead of
    // clipping to a hue the organiser never chose.
    const headroom = Math.min(lightness, 1 - lightness) / 0.5
    const candidate: Oklch = {
      mode: 'oklch',
      l: lightness,
      c: (base.c ?? 0) * Math.min(1, headroom + 0.15),
      h: base.h ?? 0,
    }

    const hex = formatHex(candidate)
    if (!hex) continue

    const candidateRatio = contrastRatio(hex, against)
    if (candidateRatio > bestRatio) {
      bestRatio = candidateRatio
      best = hex
    }
    if (candidateRatio >= ratio) return hex
  }

  // Nothing on this hue clears the bar — a mid-grey ground against a mid-grey
  // brand, for instance. Returning the best attempt would silently ship a
  // failing pair, so fall back to whichever pole actually passes.
  const black = '#000000'
  const white = '#ffffff'
  if (contrastRatio(white, against) >= ratio) return white
  if (contrastRatio(black, against) >= ratio) return black

  return best
}

/**
 * Perceptual distance between two colours, in OKLab.
 *
 * Not the same question as contrast. Two colours can differ wildly in hue and
 * still sit at the same luminance, which is a 1.1:1 contrast ratio and an
 * obvious visual difference. "Is the focus ring mistakable for the brand
 * accent" is a colour-difference question, so it gets the colour-difference
 * metric rather than the legibility one.
 */
export function colorDifference(a: string, b: string): number {
  return differenceEuclidean('oklab')(parse(a) ?? '#000', parse(b) ?? '#000')
}

/** Every pair the ground classes publish, checked in one place by the tests. */
export interface ContrastPair {
  name: string
  foreground: string
  background: string
  minimum: number
}
