import { discoverPdfUrl } from './zotero.js'
import { findOpenAccessPdfs } from './oa.js'
import { loadPdfSource } from './pdf.js'

/**
 * @param {Record<string, unknown>} body
 * @param {{ store: { list: (id: string) => any[], forget: (sessionId: string, id: string) => void, attach: (sessionId: string, id: string, pdf: Record<string, unknown>) => unknown }, zotero: { collections: () => Promise<any[]>, findByDoi: (doi: string) => Promise<boolean>, save: (refs: any[], collectionId: string) => Promise<any> }, proposer?: { available: boolean, propose: (ref: any) => Promise<Record<string, unknown> | null> }, archived?: { archive: (sessionId: string, id: string) => void, unarchive: (sessionId: string, id: string) => void, isArchived: (sessionId: string, id: string) => boolean }, enricher?: { resolve: (sessionId: string, ref: any) => Promise<void> }, fetch?: typeof fetch, pdfDir?: string }} deps
 */
export async function handleApiRequest(body, deps) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求不是 JSON 对象' }
  if (body.op === 'list') {
    if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
      return { ok: false, error: '缺少 sessionId' }
    }
    const refs = []
    for (const ref of deps.store.list(body.sessionId)) {
      let inLibrary = false
      if (ref.doi) {
        try {
          inLibrary = await deps.zotero.findByDoi(ref.doi)
        } catch {
          inLibrary = false
        }
      }
      refs.push(publicRef(ref, inLibrary, deps.archived?.isArchived(body.sessionId, ref.id) ?? false))
    }
    return { ok: true, refs }
  }
  if (body.op === 'collections') {
    try {
      const collections = await deps.zotero.collections()
      return { ok: true, collections }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '读不到分类' }
    }
  }
  if (body.op === 'propose') {
    if (typeof body.sessionId !== 'string' || typeof body.id !== 'string') {
      return { ok: false, error: '补题录需要 sessionId 和 id' }
    }
    const ref = deps.store.list(body.sessionId).find(row => row.id === body.id)
    if (!ref) return { ok: false, error: '这一行不在了' }
    if (!deps.proposer || !deps.proposer.available) return { ok: false, error: '宿主没有可用的模型服务' }
    try {
      const proposed = await deps.proposer.propose(ref, { sessionId: body.sessionId })
      if (!proposed) return { ok: false, error: '模型没有给出可用的题录' }
      deps.store.propose(body.sessionId, body.id, proposed)
      return { ok: true, proposed: publicProposal(proposed) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '模型补题录失败' }
    }
  }
  if (body.op === 'confirm') {
    if (typeof body.sessionId !== 'string' || typeof body.id !== 'string') {
      return { ok: false, error: '确认需要 sessionId 和 id' }
    }
    const accepted = body.accept !== false
    const row = deps.store.confirm(body.sessionId, body.id, accepted)
    if (!row) return { ok: false, error: '这一行不在了' }
    return { ok: true, accepted }
  }
  if (body.op === 'archive' || body.op === 'unarchive') {
    if (typeof body.sessionId !== 'string' || typeof body.id !== 'string') {
      return { ok: false, error: '归档需要 sessionId 和 id' }
    }
    const setArchived = body.op === 'archive'
    if (!deps.archived) return { ok: false, error: '归档不可用' }
    if (setArchived) deps.archived.archive(body.sessionId, body.id)
    else deps.archived.unarchive(body.sessionId, body.id)
    return { ok: true, archived: setArchived }
  }
  if (body.op === 'refresh') {
    if (typeof body.sessionId !== 'string' || typeof body.id !== 'string') {
      return { ok: false, error: '更新题录需要 sessionId 和 id' }
    }
    const ref = deps.store.list(body.sessionId).find(row => row.id === body.id)
    if (!ref) return { ok: false, error: '这一行不在了' }
    if (!ref.doi && !ref.arxiv) return { ok: false, error: '这一行没有可重查的标识' }
    if (!deps.enricher) return { ok: false, error: '宿主没有可用的题录服务' }
    await deps.enricher.resolve(body.sessionId, ref)
    return { ok: true }
  }
  if (body.op === 'fetchPdf') {
    const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string') : []
    if (typeof body.sessionId !== 'string' || ids.length === 0) {
      return { ok: false, error: '找 PDF 需要 sessionId 和 ids' }
    }
    const rows = deps.store.list(body.sessionId)
    const results = []
    for (const id of ids) {
      const ref = rows.find(row => row.id === id)
      if (!ref) {
        results.push({ id, ok: false, error: '这一行不在了' })
        continue
      }
      const candidates = []
      if (ref.pdfUrl) candidates.push(ref.pdfUrl)
      const discovered = discoverPdfUrl(ref)
      if (discovered) candidates.push(discovered)
      if (ref.doi) candidates.push(...await findOpenAccessPdfs(ref.doi, { fetch: deps.fetch }))
      const urls = [...new Set(candidates.filter(url => typeof url === 'string' && url.length > 0))]
      if (urls.length === 0) {
        results.push({ id, ok: false, error: '没找到可下载的 PDF' })
        continue
      }
      // A host can refuse one copy while another works (a publisher blocking the
      // printable URL, a preprint host rate-limiting), so try them in order.
      let failure = ''
      let done = false
      for (const url of urls) {
        try {
          const loaded = await loadPdfSource({ url }, { fetch: deps.fetch, dir: deps.pdfDir })
          deps.store.attach(body.sessionId, id, { pdfPath: loaded.path, pdfUrl: loaded.url || url })
          results.push({ id, ok: true, bytes: loaded.bytes.byteLength, url: loaded.url || url })
          done = true
          break
        } catch (error) {
          failure = error instanceof Error ? error.message : '下载失败'
        }
      }
      if (!done) results.push({ id, ok: false, error: failure || '下载失败' })
    }
    return { ok: true, results }
  }
  if (body.op === 'save') {
    if (typeof body.sessionId !== 'string' || !Array.isArray(body.ids) || typeof body.collectionId !== 'string' || body.collectionId.length === 0) {
      return { ok: false, error: '保存需要 sessionId、ids 和已有分类' }
    }
    const wanted = new Set(body.ids.filter(id => typeof id === 'string'))
    const refs = deps.store.list(body.sessionId).filter(ref => wanted.has(ref.id))
    if (refs.length === 0) return { ok: false, error: '没有可保存的文献' }
    try {
      const result = await deps.zotero.save(refs, body.collectionId)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '保存失败' }
    }
  }
  return { ok: false, error: '未知操作' }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ store: any, zotero: any, proposer?: any, archived?: any, enricher?: any, fetch?: typeof fetch, pdfDir?: string }} deps
 */
export async function handleHttp(req, res, deps) {
  try {
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: '只接受 POST' })
      return
    }
    const raw = await readBody(req, 1_000_000)
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      send(res, 400, { ok: false, error: 'JSON 无法解析' })
      return
    }
    const result = await handleApiRequest(body, deps)
    send(res, result.ok ? 200 : 400, result)
  } catch (error) {
    send(res, 500, { ok: false, error: error instanceof Error ? error.message : '内部错误' })
  }
}

/**
 * @param {Record<string, any>} ref
 * @param {boolean} inLibrary
 */
function publicRef(ref, inLibrary, archived) {
  const meta = ref.resolved ?? {}
  return {
    id: ref.id,
    title: meta.title || ref.title,
    authors: creatorText(meta.creators) || ref.authors,
    year: yearOf(meta.date) || ref.year,
    doi: meta.DOI || ref.doi,
    arxiv: meta.arxiv || ref.arxiv,
    url: meta.url || ref.url,
    abstract: meta.abstractNote || ref.abstract,
    publicationTitle: meta.publicationTitle || '',
    volume: meta.volume || '',
    issue: meta.issue || '',
    pages: meta.pages || '',
    pdfUrl: ref.pdfUrl,
    pdfPath: ref.pdfPath,
    kind: ref.kind,
    hasHtml: Boolean(ref.html),
    hasPdf: Boolean(ref.pdfPath || ref.pdfUrl || discoverPdfUrl(ref)),
    resolved: Object.keys(meta).length > 0,
    // Model help is a suggestion until the user confirms it.
    proposal: ref.proposalState === 'pending' ? publicProposal(ref.proposed) : null,
    canPropose: Boolean(ref.excerpt && ref.excerpt.trim().length >= 40),
    proposalState: ref.proposalState ?? '',
    inLibrary,
    archived: Boolean(archived),
    why: ref.why || '',
  }
}

/**
 * @param {Record<string, any>} proposed
 */
function publicProposal(proposed) {
  const meta = proposed ?? {}
  return {
    title: meta.title || '',
    authors: creatorText(meta.creators),
    year: yearOf(meta.date),
    publicationTitle: meta.publicationTitle || '',
    doi: meta.DOI || '',
    arxiv: meta.arxiv || '',
    url: meta.url || '',
    itemType: meta.itemType || '',
  }
}

/**
 * @param {unknown} creators
 */
function creatorText(creators) {
  if (!Array.isArray(creators)) return ''
  return creators
    .map(creator => [creator?.firstName, creator?.lastName].filter(part => typeof part === 'string' && part.length > 0).join(' '))
    .filter(Boolean)
    .join(', ')
}

/**
 * @param {unknown} date
 */
function yearOf(date) {
  if (typeof date !== 'string') return ''
  const match = /\d{4}/.exec(date)
  return match ? match[0] : ''
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
