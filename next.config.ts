import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // `pg` opens TCP sockets and loads optional native bindings. Bundling it into
  // the server output makes the bundler resolve modules it cannot, so it stays
  // external and is required at runtime instead.
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],

  typedRoutes: true,

  // Stage 8 adds the full header set and a CSP. These three are the ones with
  // no configuration to get wrong, so there is no reason to wait for them.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
