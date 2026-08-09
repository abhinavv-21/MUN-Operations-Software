import { notFound, redirect } from 'next/navigation'
import { createCtx, type Ctx, type CreateCtxOptions } from './ctx.ts'
import { isApiError } from './errors.ts'

/**
 * Sends anyone with an unfinished profile to the step that finishes it.
 *
 * Applied by the app's entry points rather than inside `pageCtx`, because
 * `/onboarding` itself builds a context and a check there would loop.
 */
export function requireCompletedProfile(ctx: Ctx): void {
  if (ctx.user && !ctx.user.profileCompletedAt) redirect('/onboarding')
}

/**
 * `createCtx` for Server Components.
 *
 * Same context, same authorization, same 404-not-403 rule — translated into
 * Next's navigation primitives instead of a `Response`, because a Server
 * Component cannot return one.
 *
 * This is what invariant 3 buys: the checks live in the service layer, so a
 * page and a route handler cannot disagree about who may see something. If the
 * membership check lived in the route handler, the first paint would render
 * before anything checked.
 */
export async function pageCtx(options: CreateCtxOptions = {}): Promise<Ctx> {
  try {
    return await createCtx(options)
  } catch (error) {
    if (!isApiError(error)) throw error

    if (error.code === 401) redirect('/sign-in')
    if (error.code === 404) notFound()

    throw error
  }
}
