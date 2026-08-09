import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 stopped loading .env by itself and moved connection URLs out of the
// schema. Both changes land here.
//
// The CLI gets DIRECT_URL, never DATABASE_URL. Migrations take advisory locks
// and run DDL, and a transaction-mode pooler holds neither across statements.
// DATABASE_URL is for the runtime client only, where it is handed to a driver
// adapter in src/server/db.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
})
