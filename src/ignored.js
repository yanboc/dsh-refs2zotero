import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Rows the user told the sidebar to ignore.
 *
 * The list itself is rebuilt from the session log on every plugin mount, so an
 * ignore that only lived in memory would come back the next time the plugin
 * loaded. This keeps the set on disk, per session. Reads are synchronous on
 * purpose: the replay that rebuilds a session's list runs synchronously at
 * mount, and it has to know what to skip before it publishes rows.
 *
 * @param {{ dir?: string }} [deps]
 */
export function createIgnoredStore(deps = {}) {
  const dir = deps.dir ?? join(tmpdir(), 'dsh-refs2zotero')
  /** @type {Map<string, Set<string>>} */
  const cache = new Map()

  const file = sessionId => join(dir, `ignored-${encodeURIComponent(sessionId)}.json`)

  function load(sessionId) {
    const cached = cache.get(sessionId)
    if (cached) return cached
    /** @type {Set<string>} */
    let ids = new Set()
    try {
      const parsed = JSON.parse(readFileSync(file(sessionId), 'utf8'))
      if (Array.isArray(parsed)) ids = new Set(parsed.filter(id => typeof id === 'string' && id.length > 0))
    } catch {
      // No file yet, or it is unreadable: nothing is ignored.
    }
    cache.set(sessionId, ids)
    return ids
  }

  return {
    /**
     * @param {string} sessionId
     * @param {string} id
     */
    has(sessionId, id) {
      return load(sessionId).has(id)
    },
    /**
     * @param {string} sessionId
     * @param {string} id
     */
    add(sessionId, id) {
      const ids = load(sessionId)
      ids.add(id)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file(sessionId), JSON.stringify([...ids]))
      } catch {
        // Losing the record only means the row can reappear after a remount.
      }
    },
  }
}
