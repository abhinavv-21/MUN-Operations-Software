/**
 * The route handler wrapper.
 *
 * This exists in Stage 1, before there is a second route, on purpose. Leaving
 * Express costs one readable middleware-order file; without a single wrapper,
 * every route re-implements authentication slightly differently and the
 * difference is invisible until one of them is wrong.
 *
 * A route handler built on this is a ten-line adapter: parse, validate, call a
 * service, serialise. Nothing else belongs in one.
 */

import { NextResponse } from 'next/server'
import { ApiError, isApiError } from './errors.ts'
import { translatePrismaError } from './prisma-errors.ts'
import { createCtx, type AuthMode, type Ctx, type CreateCtxOptions } from './ctx.ts'

export interface ApiHandlerArgs<P> {
  request: Request
  params: P
  ctx: Ctx
}

export interface WithApiOptions<P> {
  /**
   * Defaults to `'required'`, which fails closed: a route that forgets to say
   * anything is a route nobody can reach anonymously.
   */
  auth?: AuthMode
  /**
   * The route param holding the organisation slug, usually `'orgSlug'`.
   * Declaring it is what makes a non-member get a 404 rather than data.
   */
  orgParam?: Extract<keyof P, string>
  /** The route param holding the conference id. */
  conferenceParam?: Extract<keyof P, string>
  /**
   * Escape hatch for routes whose scope is not in the path — an invitation
   * token, for instance, where the organisation is discovered by looking it up.
   */
  resolveScope?: (request: Request, params: P) => Promise<CreateCtxOptions> | CreateCtxOptions
  /**
   * Names the audit action this route is expected to write. A mutating route
   * that declares one and does not write it warns in development.
   */
  audit?: string
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json(error.toBody(), { status: error.code })
}

/**
 * Turns anything thrown into the one error shape.
 *
 * Order matters: a deliberate ApiError wins over translation, translation wins
 * over the 500 fallback, and the fallback never leaks a message it did not
 * choose. `EXPOSE_ERROR_DETAILS` fails closed, so an unset variable in
 * production is the safe value rather than the broken one.
 */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error

  const translated = translatePrismaError(error)
  if (translated) return translated

  const exposeDetails = process.env.EXPOSE_ERROR_DETAILS === 'true'
  const details =
    exposeDetails && error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : undefined

  // Stacks are logged for genuine 500s only. A 404 in the log is noise that
  // trains you to ignore the log.
  console.error('[api] unhandled error', error)

  return ApiError.internal('Something went wrong', details)
}

export function withApi<P = Record<string, never>>(
  handler: (args: ApiHandlerArgs<P>) => Promise<Response> | Response,
  options: WithApiOptions<P> = {},
) {
  return async (
    request: Request,
    context: { params: Promise<P> } | undefined,
  ): Promise<Response> => {
    let ctx: Ctx | undefined

    try {
      const params = ((await context?.params) ?? {}) as P

      const fromPath: CreateCtxOptions = {
        auth: options.auth ?? 'required',
        organizationSlug: options.orgParam
          ? String((params as Record<string, unknown>)[options.orgParam])
          : undefined,
        conferenceId: options.conferenceParam
          ? String((params as Record<string, unknown>)[options.conferenceParam])
          : undefined,
      }

      const scopeOptions = options.resolveScope
        ? await options.resolveScope(request, params)
        : fromPath

      ctx = await createCtx({ ...fromPath, ...scopeOptions, request })

      const response = await handler({ request, params, ctx })

      // The reference enforces this with `auditGuard` middleware on
      // res.on('finish'). It reads better here, because the wrapper already
      // knows the method, the outcome and whether a row was written.
      if (
        process.env.NODE_ENV === 'development' &&
        options.audit &&
        MUTATING_METHODS.has(request.method) &&
        response.ok &&
        !ctx.audit.written
      ) {
        console.warn(
          `[audit] ${request.method} ${new URL(request.url).pathname} succeeded but wrote no ` +
            `AuditLog row (expected "${options.audit}")`,
        )
      }

      return response
    } catch (error) {
      return errorResponse(toApiError(error))
    }
  }
}

/** Convenience for the common `return json(value)` ending. */
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status })
}
