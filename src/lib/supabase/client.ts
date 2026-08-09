'use client'

import { createBrowserClient } from '@supabase/ssr'
import { supabaseAnonKey, supabaseUrl } from './config.ts'

/**
 * The browser client, used only for sign-in, sign-out and OAuth redirects.
 *
 * It is never used to read application data. Every table has row level security
 * enabled with no policies and `anon` revoked, so PostgREST answers this key
 * with `permission denied` by design — data comes from our own API and Server
 * Components, which go through the tenant-scoped Prisma client.
 */
let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function supabaseBrowser() {
  browserClient ??= createBrowserClient(supabaseUrl(), supabaseAnonKey())
  return browserClient
}
