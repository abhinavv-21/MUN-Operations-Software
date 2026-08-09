/**
 * Renders the theme into the first byte.
 *
 * No cookie, no client script, no `next-themes`. The organisation is known from
 * the URL segment, so its layout can serialise the variables straight into the
 * document — which means there is no moment where the page is painted in one
 * palette and then repainted in another.
 *
 * Verifiable by disabling JavaScript entirely and viewing source: the `--t-*`
 * block is above any content.
 *
 * The values cannot contain anything but hex colours, lengths and font stacks.
 * `themeSchema` rejects everything else, so what reaches this element is not
 * organiser-controlled markup — which is why storing arbitrary CSS was refused
 * in the first place.
 */
export function ThemeStyle({ css }: { css: string }) {
  return <style dangerouslySetInnerHTML={{ __html: `:root{${css}}` }} />
}
