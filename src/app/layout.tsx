import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product.ts'
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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
