import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The rows the user archived.
 *
 * An archived row is hidden by default but still exists: the list is rebuilt
 * from the session log on every plugin mount, so the decision has to live on
 * disk, per session. Reads are synchronous because the replay runs
 * synchronously at mount and the UI filters against this set on every `list`.
 *
 * @param {{ dir?: string }} [deps]
 */
export function createArchivedStore(deps = {}) {
  const dir = deps.dir ?? join(tmpdir(), 'dsh-refs2zotero')
  /** @type {Map<string, Set<string>>} */
  const cache = new Map()

  const file = sessionId => join(dir, `archived-${encodeURIComponent(sessionId)}.json`)

  function load(sessionId) {
    const cached = cache.get(sessionId)
    if (cached) return cached
    /** @type {Set<string>} */
    let ids = new Set()
    try {
      const parsed = JSON.parse(readFileSync(file(sessionId), 'utf8'))
      if (Array.isArray(parsed)) ids = new Set(parsed.filter(id => typeof id === 'string' && id.length > 0))
    } catch {
      // No file yet, or unreadable: nothing archived.
    }
    cache.set(sessionId, ids)
    return ids
  }

  function save(sessionId) {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file(sessionId), JSON.stringify([...load(sessionId)]))
    } catch {
      // Losing the record only means the row's archived state is forgotten.
    }
  }

  return {
    /**
     * @param {string} sessionId
     * @param {string} id
     */
    isArchived(sessionId, id) {
      return load(sessionId).has(id)
    },
    /**
     * @param {string} sessionId
     * @param {string} id
     */
    archive(sessionId, id) {
      load(sessionId).add(id)
      save(sessionId)
    },
    /**
     * @param {string} sessionId
     * @param {string} id
     */
    unarchive(sessionId, id) {
      load(sessionId).delete(id)
      save(sessionId)
    },
  }
}
