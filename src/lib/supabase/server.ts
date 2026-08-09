import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAnonKey, supabaseUrl } from './config.ts'

/**
 * The Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Session state lives in cookies rather than `localStorage`, which is the main
 * thing gained by collapsing the reference product's separate SPA and API into
 * one origin: the token is never readable by script, and the first server
 * render already knows who the caller is.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot set cookies. This is not an error to
          // recover from: proxy.ts refreshes the session on every request
          // before the render begins, so by the time a Server Component asks,
          // the cookie is already current.
        }
      },
    },
  })
}
