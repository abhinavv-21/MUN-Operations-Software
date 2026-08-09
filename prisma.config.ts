import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 stopped loading .env by itself and moved connection URLs out of the
// schema. Both changes land here.
//
// The CLI gets DIRECT_URL, never DATABASE_URL. Migrations take advisory locks
// and run DDL, and a transaction-mode pooler holds neither across statements.
// DATABASE_URL is for the runtime client only, where it is handed to a driver
// adapter in src/server/db.ts.

// Only `migrate dev` needs a shadow database, and only a developer has one.
// `migrate deploy` — which is what CI and the Vercel build run — is
// forward-only and never touches it. Declaring it with env() made the whole
// config fail to load wherever the variable was absent, which took out CI and
// would have taken out the production deploy in exactly the same way.
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
})
