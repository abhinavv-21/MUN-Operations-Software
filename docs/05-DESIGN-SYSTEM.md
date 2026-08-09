# Design system

Every colour in the product comes from a row in the database.

---

## The shape of it

```
src/lib/theme/schema.ts     what an organiser may set — four seed colours, validated
src/lib/theme/contrast.ts   WCAG ratios and ensureContrast()
src/lib/theme/build.ts      buildThemeVars() — seeds → the full token set, in OKLCH
src/styles/tokens.css       @theme mapping token names → runtime variables; ground classes
src/components/ThemeStyle   renders :root{…} into the document
src/server/services/theme   reads the row, caches per organisation
```

An organiser sets a **preset plus four seeds** — `primary`, `ink`, `paper`, `accent` — a radius, a
font and a logo. Not arbitrary CSS: that is an XSS surface, and an unmaintainable one, because every
future change to the token set would break whatever they had written against the old names.

Everything else — hovers, pressed states, tints, washes, hairlines, every on-ground pair — is
derived.

---

## Token names are the migration contract

`canvas`, `surface`, `surface-sunken`, `surface-inverted`, `ink`, `ink-secondary`, `ink-tertiary`,
`ink-inverted`, `accent`, `accent-hover`, `accent-pressed`, `accent-wash`, `accent-bright`,
`success`, `warning`, `danger`, `info` (each with a `-wash`), `edge`, `edge-strong`, `focus`.

These are exactly the names the predecessor's thirteen feature folders already use. Those screens
port with **zero colour edits** as long as nothing here is renamed. What changed is where the values
come from — a database row rather than a hex literal in a config file.

`tests/theme.test.ts` asserts every one of these is published.

---

## Two type scales, and why

The product's scale tops out at 40px (`text-display`), because a dashboard read at arm's length all
day does not want a headline. The marketing pages have their own three sizes on top of it:

| Token | Size | Where |
| --- | --- | --- |
| `text-hero` | `clamp(2.75rem, 6.6vw, 5.25rem)` | one per page — the landing headline |
| `text-title` | `clamp(1.875rem, 3.4vw, 2.875rem)` | marketing section headings |
| `text-lead` | `clamp(1.0625rem, 1.15vw, 1.1875rem)` | the paragraph under a hero or title |

Fluid rather than stepped at breakpoints. A `clamp()` has no jump to get wrong, and the hero is the
one element where a 390px phone and a 1440px laptop genuinely want different sizes rather than the
same size twice.

**Any new named size must be registered in `src/lib/utils.ts`.** `tailwind-merge` treats
`text-<name>` as a *colour* unless it knows the name is a font size, so an unregistered
`text-hero` beside `text-ink` silently deletes one of them. That is trap 5, and it cost a contrast
failure on every primary button once already.

---

## Ground classes

Five: `.ground-app`, `.ground-paper`, `.ground-ink`, `.ground-blush`, `.ground-brand`.

Each republishes the same seven locals: `--ground`, `--on-ground`, `--on-ground-muted`,
`--hairline`, `--focus-ring`, `--accent-on-ground`, `--border-interactive`.

**That is the whole trick.** A section reads `--on-ground`, never `--color-ink`, so placing it on a
dark ground cannot leave the text invisible. The predecessor's hardcoded text colour on a plum
ground was 1.02:1, and the ground class is what makes writing that impossible.

On `.ground-brand` the accent *is* the background, so `--accent-on-ground` resolves to the readable
text colour instead.

### Using them: the landing page is the proof

The grounds existed from Stage 3 and were used on almost nothing until Stage 9. The landing page now
moves through four of the five, and that progression *is* its visual rhythm:

```
hero            .ground-app      light, the matrix
the difference  .ground-ink      dark — the one tonal event on the page
the three hours (default)        light again, so the dark section reads as a break
two promises    .ground-blush    tinted
conversion      .ground-brand    saturated, once, at the only place it converts
```

Two rules that are easy to get wrong inside a ground:

- **Use `text-on-ground` and `text-on-ground-muted`, never `text-ink`.** The ground republishes
  seven locals precisely so that a section can be dark without any of its text having to know. A
  `text-ink` inside `.ground-ink` is near-black on near-black.
- **Use `border-hairline`, not `border-edge`**, for the same reason.

`.ground-brand` is for one conversion point per page. Two saturated sections is none.

---

## The contrast contract, as code

The predecessor keeps it as a hand-maintained table of eleven measured pairs in a comment. Its own
decision record says this is the one thing to do differently: the moment an organiser picks their
own navy, every number in that comment is a guess.

So it is a function with a test.

`ensureContrast({ color, against, ratio, direction })` walks OKLCH **lightness** until the pair
clears the bar, never touching hue — the hue is the organiser's brand. Chroma eases off near the
extremes, where high-chroma colours cannot exist in sRGB and would clip to something unrelated.

- **4.5:1** for anything carrying text.
- **3:1** for interactive boundaries. The predecessor's default hairline is 1.21:1 — fine for
  dividing content, illegal as the only visible edge of a control.
- A colour that already passes is returned **untouched**. Nudging colours that were fine is how a
  brand slowly stops looking like itself.
- When no point on the hue clears the bar — a mid-grey brand on a mid-grey paper — it falls back to
  whichever pole passes rather than shipping a best-effort failure.

`contrastPairs(vars)` lists every pair the grounds publish, and lives beside the derivation rather
than in the test, so adding a token that carries text and forgetting to check it is a visible
omission here rather than an invisible one over there.

`tests/theme.test.ts` runs six seeds including a deliberately awful pale yellow and a
mid-grey-on-mid-grey case.

**Focus is deliberately not the brand colour** — a focus ring matching the accent is
indistinguishable from a hover state. It is blue by default and moved to the opposite side of the
wheel when the brand is itself blue. Distinctness is measured as OKLab colour difference, not
contrast ratio: two colours can be opposite on the wheel and identical in luminance.

---

## Injection, and why there is no flash

The root layout renders the product default into `<head>`. An organisation layout renders its own
block later in the document, which wins on source order. The public registration page renders the
conference's own theme, falling back to the organisation's.

No cookie, no client script, no `next-themes`. **Verifiable by disabling JavaScript** and viewing
source: the `--t-*` block precedes any content.

Theme reads are cached per organisation with a tag built from the id — a single shared tag would
mean one organisation's save invalidated everyone's. **Development reads straight through**, because
"edit the row, reload, everything changes" should look like what it is.

---

## `tailwind-merge` must know the named scales

`src/lib/utils.ts` registers `font-size`, `rounded` and `shadow` with `extendTailwindMerge`.

This is not tidiness. Our font sizes are *named* (`text-body`, `text-h1`), not numeric.
tailwind-merge assumes any `text-<x>` is a colour unless it knows `<x>` is a size — so it read
`text-body` as a colour, decided it conflicted with `text-ink-inverted`, and kept only the last.
Every primary button rendered with default dark text on the accent fill: the exact contrast failure
the derivation exists to prevent, thrown away before it reached the DOM.

**Any new named scale must be registered there too.** `tests/ui.test.ts` guards it.

---

## The colour check

`npm run lint` runs `scripts/check-no-arbitrary-colors.mjs`, which scans `src/app` and
`src/components` for arbitrary Tailwind colours, hex literals and colour functions.

Without a check like this, themes stop being swappable within a month: one `bg-[#fff]` is invisible
in review, ships, and is then load-bearing for whoever comes next.

Colour is defined in `src/styles/tokens.css` and `src/lib/theme/` and nowhere else. The single
exemption is `public/google.svg` — Google's brand colours are mandated and therefore cannot be
themed, which is precisely why they live outside the token system rather than inside it with an
exception.

---

## The UI kit

`src/components/ui/` — `Button`, `Card`, `Badge`, `DataTable`, `Field`, `Modal`, `PageHeader`,
`SaveIndicator`, `States`. Plus `layout/AppShell` and `layout/navigation`.

Ported from the predecessor with their reasoning intact. No component library, no CVA — variants
are plain `Record<Variant, string>` maps, readable at a glance with no configuration to learn.

Details that exist because something broke once:

- **`Button` passes the spinner and children as two separate children**, not a fragment. Slot looks
  for a `Slottable` among its own children; wrapping them makes it see one fragment, never find the
  Slottable, and drop every prop — so `<Button asChild>` rendered as unstyled bare text.
- **`Modal` takes `holdsInput`.** A dialog closes when you click behind it and forms clear on close,
  so a mis-aimed click while a two-hundred-row CSV was pasted threw it away. A stray click is not a
  decision to discard.
- **`Badge` never uses colour alone** — always an icon and a word, so it survives greyscale, colour
  blindness and a phone held at an angle in a bright corridor.
- **`Field` keeps a persistent label.** A placeholder is not a label: it disappears exactly when the
  person most needs it.
- **`DataTable` scrolls inside itself, never the body.** A page that scrolls sideways on a phone is
  how a check-in screen becomes unusable while someone holds a queue up.

`/dev/kitchen-sink` renders every component in every state and **404s in production**. It is how a
theme change is judged: a palette that looks fine on the dashboard can still put a badge at 2:1, and
that is only visible side by side.
