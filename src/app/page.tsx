import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product.ts'

/**
 * A placeholder, replaced by the marketing page in Stage 8.
 *
 * It exists so that a deployment has something at `/` other than a 404, which
 * makes "is this deployed" answerable without reading logs.
 */
export default function HomePage() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>{PRODUCT_DESCRIPTION}</p>
      <p>
        Stage 1: the skeleton, the database and the tenancy guarantee. Health is at{' '}
        <a href="/api/health">/api/health</a>.
      </p>
    </main>
  )
}
