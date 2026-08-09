import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'

/**
 * Self-hosted at build time by next/font, so there is no request to Google at
 * runtime and no layout shift while a face loads.
 *
 * Three families, not one per theme option. `font: 'serif'` maps to a system
 * serif stack rather than a fourth download — a theme switch should not cost
 * the visitor another 80 KB of font, and Iowan Old Style / Palatino / Georgia
 * are present on effectively every device that would ask for a serif.
 */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
})

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export const fontVariables = `${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`
