#!/usr/bin/env node
/**
 * Invariant 4, enforced.
 *
 * No arbitrary colour values and no hex outside the two files allowed to hold
 * them. Without a check like this, themes stop being swappable within a month:
 * one `bg-[#fff]` is invisible in review, ships, and is then load-bearing for
 * whoever comes next.
 *
 * Scans src/app and src/components for:
 *   -[#...]        Tailwind arbitrary colour, e.g. bg-[#ff0000]
 *   #rrggbb        a bare hex literal
 *   rgb( / hsl(    a literal colour function
 *
 * Allowed: src/styles/tokens.css and src/lib/theme/**, which are where colour
 * is defined rather than used.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOTS = ['src/app', 'src/components']
const EXTENSIONS = /\.(tsx?|css)$/

const RULES = [
  {
    // bg-[#fff], text-[#123456], border-[#abc]
    pattern: /-\[#[0-9a-fA-F]{3,8}\]/g,
    message: 'arbitrary Tailwind colour',
  },
  {
    pattern: /#[0-9a-fA-F]{6}\b/g,
    message: 'hex literal',
  },
  {
    pattern: /\b(?:rgb|rgba|hsl|hsla)\(/g,
    message: 'literal colour function',
  },
]

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (EXTENSIONS.test(entry.name)) yield path
  }
}

const violations = []

for (const root of ROOTS) {
  for await (const path of walk(root)) {
    const source = await readFile(path, 'utf8')
    const lines = source.split('\n')

    lines.forEach((line, index) => {
      // A line may explain why a colour name appears without using one.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return

      for (const rule of RULES) {
        rule.pattern.lastIndex = 0
        const match = rule.pattern.exec(line)
        if (match) {
          violations.push({
            file: relative(process.cwd(), path),
            line: index + 1,
            message: rule.message,
            text: line.trim().slice(0, 120),
          })
        }
      }
    })
  }
}

if (violations.length > 0) {
  console.error('\n  Colour values found outside the theme layer:\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}  ${violation.message}`)
    console.error(`      ${violation.text}\n`)
  }
  console.error(
    '  Every colour must come from a semantic token so it can be themed at runtime.\n' +
      '  Use a token name (bg-accent, text-ink-secondary, border-edge) instead.\n' +
      '  Colour is defined in src/styles/tokens.css and src/lib/theme/ — nowhere else.\n',
  )
  process.exit(1)
}

console.log('  No arbitrary colour values. Themes stay swappable.')
