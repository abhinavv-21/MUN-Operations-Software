'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/api.ts'

/**
 * TanStack Query is the only client state manager.
 *
 * No Redux, no Zustand, no Jotai — everything else is local `useState` inside a
 * feature folder. That held for a whole conference in the reference product.
 *
 * Defaults ported verbatim, including the reasoning, because each one is a bug
 * that was fixed once already.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Never retry a request the server rejected on its merits, and never
          // retry while offline — the connection listener drives recovery.
          if (error instanceof ApiError) {
            if (error.isOffline) return false
            if (error.code >= 400 && error.code < 500) return false
          }
          return failureCount < 2
        },
      },
      mutations: {
        retry: false,
        /*
          Send it and let it fail, rather than holding it until the network
          comes back.

          React Query's default network mode PAUSES a mutation while the
          browser reports itself offline: no request is made and the promise
          never settles. Every inline-saving control awaits that promise to
          decide what to show, so an edit made on flaky venue wifi sat on
          "Saving" indefinitely with its inputs disabled — no error, no way to
          undo it, no way to retype it. When the connection returned the held
          mutation fired, so a delegate could be moved minutes after the
          operator gave up and walked away.

          `apiFetch` already turns an unreachable API into an ApiError with
          code 0. The two writes genuinely meant to survive being offline — a
          logistics request and an attendance check-in — will queue on that
          error explicitly in Stage 7. Everything else is an admin edit, which
          must fail fast so two people cannot both believe they hold the truth.
        */
        networkMode: 'always',
      },
    },
  })
}

export function Providers({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client is shared
  // across requests on the server and would leak one user's cache into
  // another's render.
  const [queryClient] = useState(makeQueryClient)

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
