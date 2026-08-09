import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A guard for a bug that cost a working sign-in page and was invisible to
 * every other check.
 *
 * Next.js inlines browser environment variables by textually replacing exactly
 * `process.env.NEXT_PUBLIC_FOO`. Reading them through a computed key —
 * `process.env[name]` inside a helper — cannot be replaced, so the values are
 * `undefined` in the browser while working perfectly on the server. Typecheck
 * passed, lint passed, every test passed, the build passed, and both sign-in
 * buttons span forever.
 *
 * There is no runtime assertion that can catch this, because by the time the
 * code runs in a test it is on the server, where the computed form works. So
 * this reads the source.
 */
describe('browser environment variables', () => {
  const raw = readFileSync('src/lib/supabase/config.ts', 'utf8')

  // Comments are stripped first: this file explains the bug it guards against,
  // and the explanation contains the very string being searched for.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('reads the public values as literal expressions Next can inline', () => {
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL')
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('never reads a NEXT_PUBLIC value through a computed key', () => {
    // `process.env[anything]` in a module the browser loads is the bug.
    expect(source).not.toMatch(/process\.env\s*\[/)
  })
})
