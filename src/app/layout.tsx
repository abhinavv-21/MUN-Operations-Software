import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { ThemeStyle } from '@/components/ThemeStyle.tsx'
import { Providers } from './providers.tsx'
import { fontVariables } from '@/lib/fonts.ts'
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product.ts'
import { defaultThemeCss } from '@/server/services/theme.ts'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
}

/*
  Reading the nonce here is what makes every page dynamic, and that is
  deliberate rather than a side effect worth avoiding.

  A nonce is per request. A statically prerendered page was generated before any
  request existed, so Next cannot stamp one onto its script tags — and the
  browser then blocks the page's own bootstrap. That is not a subtle failure: the
  server HTML paints perfectly and nothing is interactive. It was caught by
  `scripts/csp-check.mjs`, which is the only check in this repository that can
  see it, and the shape of the failure said so exactly — the dynamic pages passed
  and the static ones did not.

  So the choice is between static generation and a nonce-based policy, and it
  goes to the policy. The alternative is `'unsafe-inline'`, which permits every
  script an attacker manages to inject as readily as our own.
*/

// Typed explicitly rather than with Next's generated `LayoutProps<'/'>`, so
// that `tsc --noEmit` passes on a clean checkout with no build output.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" className={fontVariables}>
      <head>
        {/* The product default. An organisation layout renders its own block
            later in the document, which wins on source order. */}
        <ThemeStyle css={defaultThemeCss()} nonce={nonce} />
      </head>
      <body className="ground-app min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
