'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Palette } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { CapacityMeter, Card, CardHeader } from '@/components/ui/Card.tsx'
import { Field, Input, Select } from '@/components/ui/Field.tsx'
import { ErrorState } from '@/components/ui/States.tsx'
import { SaveIndicator, type SaveState } from '@/components/ui/SaveIndicator.tsx'
import { apiFetch, errorMessage } from '@/lib/api.ts'
import { buildThemeVars } from '@/lib/theme/build.ts'
import {
  PRESET_SEEDS,
  THEME_FONTS,
  THEME_PRESETS,
  THEME_RADII,
  type Theme,
} from '@/lib/theme/schema.ts'
import { contrastRatio } from '@/lib/theme/contrast.ts'

interface Usage {
  planKey: string
  planLabel: string
  conferences: { current: number; max: number }
  members: { current: number; max: number }
  delegatesPerConference: { max: number }
  committeesPerConference: { max: number }
  customBranding: boolean
}

const SEED_LABELS: Record<keyof Theme['seed'], { label: string; hint: string }> = {
  primary: { label: 'Brand', hint: 'Buttons, links, the rule under every page title.' },
  ink: { label: 'Ink', hint: 'Body text on light surfaces, and the dark ground itself.' },
  paper: { label: 'Paper', hint: 'The page behind everything.' },
  accent: { label: 'Accent', hint: 'A second colour. Never the only carrier of meaning.' },
}

export function SettingsClient({
  orgSlug,
  name: initialName,
  slug: initialSlug,
  theme: initialTheme,
  usage,
}: {
  orgSlug: string
  name: string
  slug: string
  theme: Theme
  usage: Usage
}) {
  const router = useRouter()

  const [name, setName] = useState(initialName)
  const [slug, setSlug] = useState(initialSlug)
  const [identityState, setIdentityState] = useState<SaveState>('idle')
  const [identityError, setIdentityError] = useState<string | null>(null)

  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [brandingState, setBrandingState] = useState<SaveState>('idle')
  const [brandingError, setBrandingError] = useState<string | null>(null)

  const slugChanged = slug !== initialSlug

  /**
   * The preview is derived by the same function the server uses.
   *
   * Not an approximation of it — `buildThemeVars` is what actually runs, so a
   * palette that looks wrong here looks wrong in production, and one that
   * passes the contrast contract here passes it there.
   *
   * Published as a **style attribute** on the preview wrapper rather than as a
   * `<style>` block. Two reasons, and the second is the load-bearing one: the
   * variables are scoped to the element by construction, so the settings page
   * around it keeps the saved palette while this shows the unsaved one; and a
   * `<style>` element rendered on the client cannot carry the CSP nonce, which
   * only exists on the server. `style-src-attr` permits the attribute;
   * `style-src-elem` would refuse the block, and the preview would silently
   * show the wrong colours.
   */
  const preview = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(buildThemeVars(theme)).map(([token, value]) => [`--t-${token}`, value]),
      ) as React.CSSProperties,
    [theme],
  )

  /**
   * The one pair worth showing a number for.
   *
   * Ink on paper is the ratio that decides whether the product is readable at
   * all, and it is the one an organiser can break in a single click by picking
   * a pale ink. Everything else is derived and clamped; this is the input.
   */
  const inkOnPaper = useMemo(
    () => contrastRatio(theme.seed.ink, theme.seed.paper),
    [theme.seed.ink, theme.seed.paper],
  )

  const isCustomised = useMemo(() => {
    const preset = PRESET_SEEDS[theme.preset]
    return (Object.keys(preset) as (keyof typeof preset)[]).some(
      (key) => theme.seed[key] !== preset[key],
    )
  }, [theme])

  async function saveIdentity(event: React.FormEvent) {
    event.preventDefault()
    setIdentityState('saving')
    setIdentityError(null)

    try {
      await apiFetch(`/api/orgs/${orgSlug}`, { method: 'PATCH', body: { name, slug } })
      setIdentityState('saved')
      /*
        The slug is in the URL, so the page has to move with it rather than
        sitting on an address that no longer resolves. `router.push` and not a
        location assign: this is a Next route, and a full document load would
        throw away the theme block the layout has already rendered and repaint
        the whole product.
      */
      if (slugChanged) router.push(`/app/${slug}/settings`)
      router.refresh()
    } catch (error) {
      setIdentityState('error')
      setIdentityError(errorMessage(error))
    }
  }

  async function saveBranding() {
    setBrandingState('saving')
    setBrandingError(null)

    try {
      await apiFetch(`/api/orgs/${orgSlug}/branding`, { method: 'PUT', body: theme })
      setBrandingState('saved')
      router.refresh()
    } catch (error) {
      setBrandingState('error')
      setBrandingError(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------------- */}

      <Card>
        <CardHeader
          title="Name and address"
          description="The name appears throughout the product. The address is in every link you give out."
        />

        <form onSubmit={saveIdentity} className="flex flex-col gap-4">
          {identityError ? <ErrorState title="That did not save" message={identityError} /> : null}

          <Field label="Name" required>
            {({ id }) => (
              <Input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
              />
            )}
          </Field>

          <Field
            label="Address"
            hint="Lowercase letters, numbers and single hyphens."
            required
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                value={slug}
                aria-describedby={describedBy}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                maxLength={48}
              />
            )}
          </Field>

          {slugChanged ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-card border border-warning bg-warning-wash p-4"
            >
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 text-body-sm text-ink">
                <p className="font-medium">Every link you have given out will stop working.</p>
                <p className="mt-1 text-ink-secondary">
                  Registration pages move from <code>/r/{initialSlug}/…</code> to{' '}
                  <code>/r/{slug}/…</code>. Posters, newsletters and anything a school has already
                  bookmarked will 404. The old address becomes free for somebody else to take.
                </p>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              loading={identityState === 'saving'}
              disabled={name.trim().length < 2 || slug.trim().length < 3}
            >
              Save
            </Button>
            <span aria-live="polite">
              <SaveIndicator state={identityState} />
            </span>
          </div>
        </form>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <CardHeader
          title="Branding"
          description="Four colours. Everything else — hovers, tints, borders, every text-on-background pair — is derived from them and checked for contrast before it is used."
          actions={
            <Button loading={brandingState === 'saving'} onClick={saveBranding}>
              <Palette size={16} aria-hidden />
              Save branding
            </Button>
          }
        />

        {brandingError ? <ErrorState title="That did not save" message={brandingError} /> : null}

        {!usage.customBranding ? (
          <p className="mb-4 rounded-card border border-edge bg-surface-sunken p-4 text-body-sm text-ink-secondary">
            Your plan includes the presets. Changing an individual colour needs custom branding —
            email us and we will turn it on.
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Field label="Preset" hint="A starting point, not a reset — your edits are kept.">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  value={theme.preset}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    const preset = event.target.value as Theme['preset']
                    // Choosing a preset applies its seeds. Anything else would
                    // make the control do nothing visible on a customised
                    // theme, which reads as broken.
                    setTheme({ ...theme, preset, seed: { ...PRESET_SEEDS[preset] } })
                  }}
                >
                  {THEME_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(SEED_LABELS) as (keyof Theme['seed'])[]).map((key) => (
                <Field key={key} label={SEED_LABELS[key].label} hint={SEED_LABELS[key].hint}>
                  {({ id, describedBy }) => (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={`${SEED_LABELS[key].label} colour`}
                        value={theme.seed[key]}
                        disabled={!usage.customBranding}
                        onChange={(event) =>
                          setTheme({
                            ...theme,
                            seed: { ...theme.seed, [key]: event.target.value },
                          })
                        }
                        className="size-10 shrink-0 cursor-pointer rounded-control border border-edge-strong bg-surface disabled:cursor-not-allowed"
                      />
                      <Input
                        id={id}
                        value={theme.seed[key]}
                        aria-describedby={describedBy}
                        disabled={!usage.customBranding}
                        onChange={(event) =>
                          setTheme({
                            ...theme,
                            seed: { ...theme.seed, [key]: event.target.value.toLowerCase() },
                          })
                        }
                        className="font-mono"
                      />
                    </div>
                  )}
                </Field>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Corners">
                {({ id }) => (
                  <Select
                    id={id}
                    value={theme.radius}
                    onChange={(event) =>
                      setTheme({ ...theme, radius: event.target.value as Theme['radius'] })
                    }
                  >
                    {THEME_RADII.map((radius) => (
                      <option key={radius} value={radius}>
                        {radius}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Typeface">
                {({ id }) => (
                  <Select
                    id={id}
                    value={theme.font}
                    onChange={(event) =>
                      setTheme({ ...theme, font: event.target.value as Theme['font'] })
                    }
                  >
                    {THEME_FONTS.map((font) => (
                      <option key={font} value={font}>
                        {font}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <p className="text-body-sm text-ink-secondary">
              {isCustomised ? 'Customised from the preset.' : 'Using the preset unchanged.'}{' '}
              Ink on paper measures{' '}
              <span className="font-mono tabular-nums text-ink">{inkOnPaper.toFixed(1)}:1</span>
              {inkOnPaper >= 7 ? (
                <span className="text-success"> — comfortable</span>
              ) : inkOnPaper >= 4.5 ? (
                <span className="text-success"> — passes</span>
              ) : (
                <span className="text-danger"> — too low to read; darken the ink</span>
              )}
              .
            </p>
          </div>

          <ThemePreview vars={preview} />
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <CardHeader
          title={`${usage.planLabel} plan`}
          description="Limits are lifted with a row update rather than a deploy. Email us and we will raise them."
        />

        <div className="flex flex-col gap-5">
          <CapacityMeter
            filled={usage.conferences.current}
            total={usage.conferences.max}
            label="Conferences"
            unit="conferences"
          />
          <CapacityMeter
            filled={usage.members.current}
            total={usage.members.max}
            label="People"
            unit="people"
          />

          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              ['Delegates per conference', String(usage.delegatesPerConference.max)],
              ['Committees per conference', String(usage.committeesPerConference.max)],
              ['Custom branding', usage.customBranding ? 'Included' : 'Not included'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label uppercase text-ink-secondary">{label}</dt>
                <dd className="mt-1 font-mono text-data tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>
    </div>
  )
}

/**
 * The preview, scoped to one element.
 *
 * The derived variables are published onto this wrapper rather than the
 * document, so the surrounding settings page keeps the saved theme while the
 * preview shows the unsaved one. Applying them globally would mean the whole
 * product flickered on every keystroke of a hex field.
 */
function ThemePreview({ vars }: { vars: React.CSSProperties }) {
  return (
    <div>
      <div
        style={vars}
        className="ground-app rounded-card border border-edge p-5"
        // Not interactive, and not announced: it duplicates controls that exist
        // for real elsewhere on the page.
        aria-hidden
      >
        <p className="text-label uppercase text-ink-secondary">Preview</p>
        <h3 className="mt-2 font-heading text-h1 text-ink">Committees</h3>
        <span className="page-rule mt-3 block" />

        <div className="mt-5 rounded-card border border-edge bg-surface p-4">
          <p className="text-body text-ink">Security Council</p>
          <p className="mt-1 text-body-sm text-ink-secondary">15 seats · 12 allocated</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-control bg-accent px-4 py-2 text-body-sm font-medium text-ink-inverted">
              Allocate
            </span>
            <span className="inline-flex items-center rounded-control border border-edge-strong bg-surface px-4 py-2 text-body-sm text-ink">
              Cancel
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-success/30 bg-success-wash px-2.5 py-1 text-label uppercase text-success">
              <Check size={14} aria-hidden />
              Approved
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
