import { resolveMetadata } from './metadata.js'

/**
 * Resolve the canonical record for a collected row and fold it into the store,
 * so the sidebar shows the publisher's title and journal instead of whatever
 * the converted page happened to expose.
 *
 * A collected row keeps its own fields; the canonical record lives beside them
 * under `resolved`. The lookup is best-effort: a network failure changes
 * nothing, and one identifier is never looked up twice at the same time.
 *
 * @param {{ resolve: (sessionId: string, id: string, meta: Record<string, unknown>) => void }} store
 * @param {{ fetch?: typeof fetch }} [deps]
 */
export function createEnricher(store, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  /** @type {Set<string>} */
  const inFlight = new Set()

  return {
    /**
     * @param {string} sessionId
     * @param {{ id: string, doi?: string, arxiv?: string, resolved?: unknown }} ref
     * @returns {Promise<void>}
     */
    async resolve(sessionId, ref) {
      if (!ref || (!ref.doi && !ref.arxiv)) return
      const key = `${sessionId}:${ref.id}`
      if (inFlight.has(key)) return
      inFlight.add(key)
      try {
        const meta = await resolveMetadata(ref, { fetch: fetchImpl })
        if (meta && Object.keys(meta).length > 0) store.resolve(sessionId, ref.id, meta)
      } catch {
        // Keep the collected fields when the lookup fails.
      } finally {
        inFlight.delete(key)
      }
    },
  }
}
