/**
 * The only module in the application allowed to hold a raw database client.
 *
 * Everything else receives `ctx.db`, which is already scoped to one
 * organisation and, where relevant, one conference. An ESLint rule blocks
 * importing `unsafeDb` from anywhere but `ctx.ts`, the seed and the tests.
 *
 * The scoping mechanism is a Prisma client extension rather than a repository
 * layer, chosen for its failure mode rather than its ergonomics. A repository
 * layer is bypassed by anyone who types `unsafeDb.committee`, and nothing
 * catches it. The extension is bypassed only by raw SQL and by nested relation
 * writes, and both of those are greppable.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client.ts'
import {
  isOrgModel,
  isOrgReachableModel,
  isOrgRevocableModel,
  isTenantModel,
} from './models.ts'

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      // One connection per serverless invocation. A pool of ten behind a
      // transaction-mode pooler exhausts Supavisor's client slots long before
      // it exhausts Postgres.
      max: process.env.VERCEL ? 1 : 10,
    }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

// Next.js dev replaces modules on every edit. Without this, each edit leaks a
// connection pool until Postgres refuses new connections. Ported essentially
// verbatim from the reference product's apps/backend/src/lib/prisma.ts.
const globalForPrisma = globalThis as unknown as { unsafeDb?: PrismaClient }

/**
 * The unscoped client. Importing this outside ctx.ts, the seed or the tests is
 * an ESLint error, because a query written against it carries no tenant filter
 * and nothing downstream will add one.
 */
export const unsafeDb: PrismaClient = globalForPrisma.unsafeDb ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.unsafeDb = unsafeDb

export interface Scope {
  organizationId?: string
  conferenceId?: string
}

export type ScopeColumn = 'conferenceId' | 'organizationId'

/**
 * Create input with the injected scope column removed.
 *
 * The extension supplies the column at runtime, so callers must not pass one —
 * but Prisma's generated input types still require it, because they describe
 * the database rather than the scoped client. Typing the value as
 * `ScopedCreate<Prisma.XUncheckedCreateInput>` and casting once at the `create`
 * call keeps every other field checked, and keeps the reconciliation visible
 * instead of hidden behind an `as never`.
 *
 * The column is a parameter rather than a fixed pair because `AuditLog` carries
 * both: `organizationId` is injected, and `conferenceId` is a real field the
 * caller sets.
 */
export type ScopedCreate<T, K extends ScopeColumn = 'conferenceId'> = Omit<T, K>

/**
 * The one place the two views of a create are reconciled.
 *
 * Every field except the injected scope column is still checked against
 * Prisma's generated input type, so a typo in `canManageMembers` is caught. The
 * cast is confined here rather than repeated as a bare `as` at every call site,
 * where it would eventually be copied onto something that genuinely was missing
 * a field.
 */
export function scopedCreate<T, K extends ScopeColumn = 'conferenceId'>(
  data: ScopedCreate<T, K>,
): T {
  return data as T
}

/** The scoped client handed to services as `ctx.db`. */
export type ScopedClient = ReturnType<typeof scope>

/** Operations whose `where` clause needs the tenant filter merged in. */
const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

/** Operations whose `data` needs the tenant key injected. */
const DATA_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn'])

/**
 * The subset of WHERE_OPERATIONS that only reads. An org-reachable model may be
 * read across an organisation's conferences; writing to one still requires a
 * conference in scope.
 */
const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
])

/** `Committee` -> `committee`. Prisma delegates are the camelCase model name. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

/**
 * Returns the scoping column for a model and the value it must take, or
 * undefined for a model that is deliberately unscoped.
 *
 * Throws rather than falling through when a scoped model is reached without
 * the matching scope. Returning unfiltered rows in that situation is precisely
 * the bug this module exists to prevent, so it fails loudly instead.
 */
type ScopeFilter =
  /** Inject `{ [column]: value }`, overriding whatever the caller passed. */
  | { kind: 'column'; column: string; value: string }
  /** Inject `{ conference: { organizationId } }`. Reads only. */
  | { kind: 'via-conference'; organizationId: string }

function scopeKeyFor(model: string, operation: string, current: Scope): ScopeFilter | undefined {
  if (isTenantModel(model)) {
    if (current.conferenceId) {
      return { kind: 'column', column: 'conferenceId', value: current.conferenceId }
    }

    if (current.organizationId && isOrgReachableModel(model) && READ_OPERATIONS.has(operation)) {
      return { kind: 'via-conference', organizationId: current.organizationId }
    }

    /*
      Bulk revocation across an organisation. `deleteMany` and nothing else.

      Removing somebody from the organisation has to take their grants on every
      conference in it, and there is no single conference to scope that to.
      Still filtered by `{ conference: { organizationId } }`, so it reaches no
      other tenant. See ORG_REVOCABLE_MODELS in models.ts for the full argument
      and for why this is a separate list rather than a widening of the one
      above.
    */
    if (
      current.organizationId &&
      isOrgRevocableModel(model) &&
      operation === 'deleteMany'
    ) {
      return { kind: 'via-conference', organizationId: current.organizationId }
    }

    if (current.organizationId && isOrgReachableModel(model)) {
      throw new Error(
        `${model} may be read across an organisation, and deleted in bulk if it is ` +
          `org-revocable, but not otherwise written to. ` +
          `Scope to a single conference before ${operation}.`,
      )
    }

    throw new Error(
      `${model} is conference-scoped and was queried with no conference in scope. ` +
        `Use ctx.db from a route that resolves a conference.`,
    )
  }

  if (isOrgModel(model)) {
    if (!current.organizationId) {
      throw new Error(
        `${model} is organisation-scoped and was queried with no organisation in scope. ` +
          `Use ctx.db from a route that resolves an organisation.`,
      )
    }
    return { kind: 'column', column: 'organizationId', value: current.organizationId }
  }

  return undefined
}

function filterClause(filter: ScopeFilter): Record<string, unknown> {
  return filter.kind === 'column'
    ? { [filter.column]: filter.value }
    : { conference: { organizationId: filter.organizationId } }
}

/**
 * Builds a client that injects the tenant filter into every operation.
 *
 * Known holes, both deliberate and both greppable:
 *
 * - `$queryRaw` and `$executeRaw` bypass this entirely. An ESLint rule bans
 *   them outside this file.
 * - Nested relation writes do not get the key injected into the nested model,
 *   because the extension sees one operation on the parent. Prefer explicit
 *   top-level creates inside `runSerializable`.
 */
export function scope(current: Scope) {
  return unsafeDb.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const filter = model ? scopeKeyFor(model, operation, current) : undefined
          if (!filter) return query(args)

          if (DATA_OPERATIONS.has(operation)) {
            // Unreachable for a via-conference filter, which is reads only.
            if (filter.kind !== 'column') {
              throw new Error(`${model} cannot be created without a conference in scope.`)
            }
            const data = args?.data
            const withKey = Array.isArray(data)
              ? data.map((row: object) => ({ ...row, [filter.column]: filter.value }))
              : { ...data, [filter.column]: filter.value }
            return query({ ...args, data: withKey })
          }

          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            // A unique lookup plus a non-unique filter is no longer a unique
            // lookup, and Prisma rejects the argument shape. Rewriting to
            // findFirst is what turns "fetch by id" into "fetch by id, in this
            // tenant" without the caller having to know.
            const target = operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delegate = (unsafeDb as any)[delegateName(model)]
            return delegate[target]({
              ...args,
              where: { ...(args?.where ?? {}), ...filterClause(filter) },
            })
          }

          if (WHERE_OPERATIONS.has(operation)) {
            return query({
              ...args,
              where: { ...(args?.where ?? {}), ...filterClause(filter) },
            })
          }

          if (operation === 'upsert') {
            // Scoping an upsert safely would mean rewriting it into a
            // find-then-branch, which is a different set of race conditions
            // than the caller asked for. Refusing is honest; silently running
            // an unscoped upsert is not.
            throw new Error(
              `upsert is not available on ${model}. Use findFirst plus create or update ` +
                `inside runSerializable, so the race is one you chose.`,
            )
          }

          throw new Error(
            `Unhandled Prisma operation "${operation}" on scoped model ${model}. ` +
              `Add it to src/server/db.ts rather than letting it through unscoped.`,
          )
        },
      },
    },
  })
}

/** Scopes to one conference. Organisation-scoped models are unavailable. */
export function forConference(conferenceId: string) {
  return scope({ conferenceId })
}

/** Scopes to one organisation. Conference-scoped models are unavailable. */
export function forOrganization(organizationId: string) {
  return scope({ organizationId })
}
