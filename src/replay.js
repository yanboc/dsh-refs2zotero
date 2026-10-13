import { seedSession } from './ingest.js'

/**
 * Rebuild the in-memory lists from the session service.
 *
 * A plugin mounts at app start, but a session can outlive any number of plugin
 * loads — an HMR reload, a reinstall, a second mount. The session's own event
 * log is the durable record of what it read, so the list is derived from it
 * rather than from whatever happened to arrive after this instance started.
 *
 * @param {{ store: { list: (id: string) => any[] }, pending: Map<string, unknown>, enricher?: { resolve: (sessionId: string, ref: any) => Promise<void> } }} deps
 */
export function createReplay(deps) {
  const { store, pending, enricher } = deps

  return {
    /**
     * @param {{ id?: unknown, snapshotEvents?: () => any[] }} session
     * @returns {any[]} rows restored from that session's log
     */
    one(session) {
      if (!session || session.id == null) return []
      let restored
      try {
        restored = seedSession(store, pending, session)
      } catch {
        // A session whose log cannot be read yet (still being restored, or
        // detached) is skipped. Live events still cover it, and one unreadable
        // history must never take the whole plugin down.
        return []
      }
      const sessionId = String(session.id)
      // Fill the canonical records in one at a time: a long session should not
      // fire every identifier lookup at doi.org simultaneously.
      const kept = restored
      if (kept.length > 0 && enricher) {
        void (async () => {
          for (const ref of kept) {
            try {
              if (ref.doi || ref.arxiv) await enricher.resolve(sessionId, ref)
            } catch {
              // A failed canonical lookup leaves the harvested fields in place;
              // an unhandled rejection here would take the host down.
            }
          }
        })()
      }
      return kept
    },

    /**
     * @param {{ list?: () => any[] } | undefined} sessions
     * @returns {any[]} rows restored across every session
     */
    all(sessions) {
      const restored = []
      let live
      try {
        live = sessions?.list?.() ?? []
      } catch {
        return restored
      }
      for (const session of live) restored.push(...this.one(session))
      return restored
    },
  }
}
