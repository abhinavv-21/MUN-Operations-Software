import { describe, expect, it } from 'vitest'
import { Prisma } from '../src/generated/prisma/client.ts'
import {
  CLASSIFIED_MODELS,
  GLOBAL_MODELS,
  ORG_MODELS,
  TENANT_MODELS,
} from '../src/server/models.ts'

/**
 * The highest-value test in Stage 1, and the only one that gets more valuable
 * over time.
 *
 * The scoping extension protects the models it knows about. This protects the
 * models nobody has written yet: a table added in Stage 6 that nobody thought
 * to classify is unscoped, silently, forever. Here it is a failing build.
 *
 * It needs no database, so it runs on a laptop with nothing installed.
 *
 * Note on mechanism: the reference plan called for `Prisma.dmmf`, which Prisma
 * 7 no longer exposes at runtime. `Prisma.ModelName` is the replacement and is
 * a better source anyway — it is public, generated, and typed.
 */
describe('every model is classified', () => {
  const schemaModels = Object.keys(Prisma.ModelName)

  it('finds models to check', () => {
    // Guards against the whole suite passing vacuously if the generated client
    // ever stops exporting ModelName.
    expect(schemaModels.length).toBeGreaterThan(0)
  })

  it('classifies every model in the schema', () => {
    const classified = new Set(CLASSIFIED_MODELS)
    const unclassified = schemaModels.filter((model) => !classified.has(model))

    expect(
      unclassified,
      `These models are in the schema but not in src/server/models.ts, so they are ` +
        `unscoped: ${unclassified.join(', ')}. Add each to TENANT_MODELS, ORG_MODELS or ` +
        `GLOBAL_MODELS — and if it lands in GLOBAL_MODELS, write down why.`,
    ).toEqual([])
  })

  it('lists no model that the schema does not have', () => {
    const inSchema = new Set(schemaModels)
    const stale = CLASSIFIED_MODELS.filter((model) => !inSchema.has(model))

    expect(
      stale,
      `These models are classified but no longer exist in the schema: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('classifies each model exactly once', () => {
    const counts = new Map<string, number>()
    for (const model of CLASSIFIED_MODELS) {
      counts.set(model, (counts.get(model) ?? 0) + 1)
    }
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([model]) => model)

    expect(duplicated, `Classified in more than one bucket: ${duplicated.join(', ')}`).toEqual([])
  })

  it('keeps the buckets non-empty in the shape the design assumes', () => {
    expect(TENANT_MODELS.length).toBeGreaterThan(0)
    expect(ORG_MODELS.length).toBeGreaterThan(0)
    // GLOBAL_MODELS is the bucket that should stay small. If it grows past a
    // handful, the tenancy model has drifted and this number is the reminder.
    expect(GLOBAL_MODELS.length).toBeLessThanOrEqual(4)
  })
})
