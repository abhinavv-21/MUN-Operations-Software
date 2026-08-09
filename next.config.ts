import type { NextConfig } from 'next'

/**
 * The headers that are the same on every request.
 *
 * The content security policy is **not** here: it carries a per-request nonce
 * and so is set in `src/proxy.ts`. A CSP declared in this file would be a
 * constant, which means either no nonce or the same nonce for everybody — and
 * a reused nonce is `'unsafe-inline'` with extra steps.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /*
    Superseded by `frame-ancestors 'none'` in the CSP, and still sent. Some
    browsers in use at schools read only this one, and the cost of both is a
    duplicated intent rather than a conflict.
  */
  { key: 'X-Frame-Options', value: 'DENY' },

  /*
    Two years, subdomains included, and preload-eligible.

    Ignored entirely over plain HTTP, so it does nothing on localhost. It is
    listed without hesitation because the product is only ever served from
    Vercel over TLS — there is no HTTP deployment to strand.
  */
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },

  /*
    Nothing here uses a camera, a microphone, geolocation or payment, so all of
    them are refused rather than left to a default that changes.
  */
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  },

  /*
    Isolates the browsing context group, so a page this product opens cannot
    reach back into it through `window.opener`. Paired with the CSP's
    `frame-src 'none'`, which is the other half of the same idea.
  */
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },

  /*
    Deliberately **not** `Cross-Origin-Embedder-Policy: require-corp`. It would
    break the payment-proof images served from Backblaze, which do not send
    `Cross-Origin-Resource-Policy`, and nothing here needs the cross-origin
    isolation it buys.
  */
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig: NextConfig = {
  // `pg` opens TCP sockets and loads optional native bindings. Bundling it into
  // the server output makes the bundler resolve modules it cannot, so it stays
  // external and is required at runtime instead.
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],

  typedRoutes: true,

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        /*
          The service worker is served from the root and must not be cached, or
          a browser holds the old one and the update prompt never appears —
          which is the entire mechanism by which a deploy reaches an open tab.
        */
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
