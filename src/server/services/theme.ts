import { revalidateTag, unstable_cache } from 'next/cache'
import { buildThemeVars, serializeVars } from '@/lib/theme/build.ts'
import { parseTheme, type Theme } from '@/lib/theme/schema.ts'
import { unsafeDb } from '../db.ts'

/**
 * The theme, resolved per organisation.
 *
 * Reads the organisation directly rather than through `ctx.db`: this runs in
 * the layout, before a context exists, and the id it is given has already been
 * authorised by the membership check that produced it.
 */
async function loadTheme(organizationId: string): Promise<Theme> {
  const organization = await unsafeDb.organization.findUnique({
    where: { id: organizationId },
    select: { defaultTheme: true },
  })
  return parseTheme(organization?.defaultTheme)
}

/** The cache tag for one organisation's theme. */
export function themeTag(organizationId: string): string {
  return `org-theme:${organizationId}`
}

/**
 * Cached per organisation, so server-rendering the variables into every page is
 * not a database round trip per navigation.
 *
 * The cached function is built per id rather than once at module scope,
 * because `unstable_cache` takes its tags up front — a single shared tag would
 * mean saving one organisation's theme invalidated every other organisation's
 * too.
 *
 * Development reads straight through. The exit criterion for this stage is
 * "edit the row, reload, everything changes", and a cache that holds the old
 * palette until something calls `revalidateTag` makes that look broken when it
 * is working exactly as designed.
 */
export async function getOrganizationTheme(organizationId: string): Promise<Theme> {
  if (process.env.NODE_ENV !== 'production') return loadTheme(organizationId)

  const cached = unstable_cache(loadTheme, ['organization-theme', organizationId], {
    tags: [themeTag(organizationId)],
    // A floor under hand edits made straight against the database. Saving
    // through the product revalidates immediately; this is only for the case
    // where nothing in the application knows a change happened.
    revalidate: 300,
  })

  return cached(organizationId)
}

/**
 * Call after saving organisation branding, so the change is visible at once.
 *
 * Next 16 requires a cache-life profile alongside the tag; `{ expire: 0 }`
 * drops the entry rather than scheduling it to go stale. A settings save that
 * leaves the old palette on screen reads as a save that did not work.
 */
export function revalidateOrganizationTheme(organizationId: string): void {
  revalidateTag(themeTag(organizationId), { expire: 0 })
}

/** The CSS declarations for an organisation, ready to go into a `<style>`. */
export async function getOrganizationThemeCss(organizationId: string): Promise<string> {
  return serializeVars(buildThemeVars(await getOrganizationTheme(organizationId)))
}

/** The product default, for pages that belong to no organisation. */
export function defaultThemeCss(): string {
  return serializeVars(buildThemeVars(parseTheme(null)))
}
