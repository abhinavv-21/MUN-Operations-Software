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
 *
 * The `nonce` is what lets `style-src` refuse every *other* inline stylesheet.
 * Without it the policy would need `'unsafe-inline'` for elements as well as
 * attributes, and an injected `<style>` could then repaint the product's own
 * controls — a login form is a thing worth restyling if you are phishing.
 */
export function ThemeStyle({ css, nonce }: { css: string; nonce?: string }) {
  return <style nonce={nonce} dangerouslySetInnerHTML={{ __html: `:root{${css}}` }} />
}
