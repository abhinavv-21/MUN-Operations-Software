import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ThemeStyle } from '@/components/ThemeStyle.tsx'
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

// Typed explicitly rather than with Next's generated `LayoutProps<'/'>`, so
// that `tsc --noEmit` passes on a clean checkout with no build output.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <head>
        {/* The product default. An organisation layout renders its own block
            later in the document, which wins on source order. */}
        <ThemeStyle css={defaultThemeCss()} />
      </head>
      <body className="ground-app min-h-dvh">{children}</body>
    </html>
  )
}
