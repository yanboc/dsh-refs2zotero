/**
 * @returns {SessionStore}
 */
export function createStore() {
  /** @type {Map<string, Map<string, Reference>>} */
  const sessions = new Map()
  return {
    upsert(sessionId, ref) {
      let rows = sessions.get(sessionId)
      if (!rows) {
        rows = new Map()
        sessions.set(sessionId, rows)
      }
      const existing = [...rows.values()].find(row => sameWork(row, ref))
      if (!existing) {
        rows.set(ref.id, ref)
        return ref
      }
      const merged = mergeRef(existing, ref)
      merged.id = existing.id
      rows.set(existing.id, merged)
      return merged
    },
    list(sessionId) {
      const rows = sessions.get(sessionId)
      return rows ? [...rows.values()] : []
    },
    resolve(sessionId, id, meta) {
      const rows = sessions.get(sessionId)
      const row = rows?.get(id)
      if (!rows || !row) return
      rows.set(id, { ...row, resolved: { ...row.resolved, ...meta } })
    },
    /**
     * Record a model-proposed record. It stays a proposal until the user
     * confirms it, so nothing the model guessed is ever written silently.
     */
    propose(sessionId, id, proposed) {
      const rows = sessions.get(sessionId)
      const row = rows?.get(id)
      if (!rows || !row) return null
      const next = { ...row, proposed, proposalState: 'pending' }
      rows.set(id, next)
      return next
    },
    /** Accept or drop a pending proposal. */
    confirm(sessionId, id, accept) {
      const rows = sessions.get(sessionId)
      const row = rows?.get(id)
      if (!rows || !row) return null
      if (!accept) {
        const { proposed: _dropped, ...rest } = row
        const next = { ...rest, proposalState: 'rejected' }
        rows.set(id, next)
        return next
      }
      const next = {
        ...row,
        resolved: { ...row.resolved, ...row.proposed },
        proposalState: 'accepted',
      }
      rows.set(id, next)
      return next
    },
    /** Forget one row in this session's list. Zotero is not touched. */
    forget(sessionId, id) {
      sessions.get(sessionId)?.delete(id)
    },
    /** Record a PDF the host fetched for a row, so a later write attaches it. */
    attach(sessionId, id, pdf) {
      const rows = sessions.get(sessionId)
      const row = rows?.get(id)
      if (!rows || !row) return null
      const next = { ...row, ...pdf }
      rows.set(id, next)
      return next
    },
    drop(sessionId) {
      sessions.delete(sessionId)
    },
  }
}

/**
 * @param {Reference} left
 * @param {Reference} right
 */
function sameWork(left, right) {
  if (left.doi && right.doi && left.doi.toLowerCase() === right.doi.toLowerCase()) return true
  if (left.arxiv && right.arxiv && left.arxiv === right.arxiv) return true
  if (left.url && right.url && left.url === right.url) return true
  if (left.pdfPath && right.pdfPath && left.pdfPath === right.pdfPath) return true
  return false
}

/**
 * @param {Reference} prev
 * @param {Reference} next
 */
function mergeRef(prev, next) {
  return {
    id: prev.id,
    title: betterTitle(prev, next),
    authors: prefer(next.authors, prev.authors),
    year: prefer(next.year, prev.year),
    doi: prefer(next.doi, prev.doi),
    arxiv: prefer(next.arxiv, prev.arxiv),
    url: prefer(next.url, prev.url),
    abstract: prefer(next.abstract, prev.abstract),
    pdfUrl: prefer(next.pdfUrl, prev.pdfUrl),
    pdfPath: prefer(next.pdfPath, prev.pdfPath),
    html: prefer(next.html, prev.html),
    excerpt: longer(prev.excerpt, next.excerpt),
    resolved: { ...prev.resolved, ...next.resolved },
    proposed: next.proposed ?? prev.proposed,
    proposalState: prefer(next.proposalState, prev.proposalState),
    kind: next.kind === 'pdf' || prev.kind === 'pdf' ? 'pdf' : 'page',
  }
}

/**
 * @param {string} next
 * @param {string} prev
 */
function prefer(next, prev) {
  return next ? next : prev
}

/**
 * Keep the longest harvested excerpt: a later row (a PDF read) usually carries
 * more of the document than the first (an abstract page).
 * @param {string} prev
 * @param {string} next
 */
function longer(prev, next) {
  const left = typeof prev === 'string' ? prev : ''
  const right = typeof next === 'string' ? next : ''
  return right.length > left.length ? right : left
}

/**
 * Keep the better of two titles: a real title beats a URL, a file name, or a
 * bare identifier that a converted page happened to expose.
 * @param {Reference} prev
 * @param {Reference} next
 */
function betterTitle(prev, next) {
  const nextQuality = titleQuality(next)
  const prevQuality = titleQuality(prev)
  if (nextQuality > prevQuality) return next.title
  if (prevQuality > nextQuality) return prev.title || next.title
  return next.title || prev.title
}

/**
 * @param {Reference} ref
 */
function titleQuality(ref) {
  const title = typeof ref.title === 'string' ? ref.title.trim() : ''
  if (!title) return 0
  if (title.startsWith('<')) return 0
  if (title === ref.url || title === ref.pdfPath) return 0
  if (ref.pdfPath && title === ref.pdfPath.split(/[/\\]/).pop()) return 0
  if (/^(?:https?:\/\/|www\.)/i.test(title)) return 0
  if (/^10\.\d{4,9}\//.test(title) || /^arxiv[:\s]/i.test(title)) return 0
  return 1
}
