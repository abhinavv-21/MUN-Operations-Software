/**
 * Constrains a `?next=` value to a path on this origin.
 *
 * Without this, `/sign-in?next=https://evil.example` sends someone through a
 * genuine sign-in and then straight out to an attacker's page — the phishing
 * variant that is hard to spot precisely because the sign-in was real.
 *
 * `//evil.example` is rejected too: it starts with a slash but a browser reads
 * it as protocol-relative and treats it as another host.
 */
export function safeNextPath(value: string | undefined | null, fallback = '/app'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('\\')) return fallback
  return value
}
