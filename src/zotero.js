import { readFile } from 'node:fs/promises'
import { resolveMetadata } from './metadata.js'

const MAX_PDF_BYTES = 20 * 1024 * 1024

/**
 * @param {{ baseUrl?: string, fetch?: typeof fetch, readFile?: typeof readFile }} [options]
 */
export function createZotero(options = {}) {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:23119').replace(/\/$/, '')
  const fetchImpl = options.fetch ?? globalThis.fetch
  const read = options.readFile ?? readFile

  return {
    baseUrl,
    ping,
    collections,
    findByDoi,
    save,
  }

  async function ping() {
    const response = await fetchImpl(`${baseUrl}/connector/ping`, { method: 'GET', headers: connectorHeaders() })
    if (!response.ok) throw new Error('Zotero 没有在运行')
  }

  async function collections() {
    await ping()
    const { status, data, text } = await postJson('/connector/getSelectedCollection', {})
    if (status !== 200 || !data || !Array.isArray(data.targets)) {
      throw new Error(text || '读不到 Zotero 分类')
    }
    return data.targets
      .filter(target => target && typeof target.id === 'string' && target.id.length > 0)
      .map(target => ({
        id: target.id,
        name: typeof target.name === 'string' ? target.name : target.id,
        level: typeof target.level === 'number' ? target.level : 0,
      }))
  }

  /**
   * @param {string} doi
   * @returns {Promise<boolean>}
   */
  async function findByDoi(doi) {
    // `qmode=everything` is required: the default search only covers title,
    // creator, and year, so a plain `q=<doi>` never matches a stored DOI.
    const query = `q=${encodeURIComponent(doi)}&qmode=everything`
    const response = await fetchImpl(`${baseUrl}/api/users/0/items?${query}`, {
      headers: connectorHeaders(),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const detail = text.trim()
      const error = new Error(detail ? `查重失败 ${response.status}: ${detail}` : `查重失败 ${response.status}`)
      // Zotero answers 403 on its whole Local API while the preference is off.
      // That is a missing capability, not a repository fault: the caller may
      // still write, it just cannot know whether the work is already there.
      error.code = response.status === 403 ? 'DEDUPE_UNAVAILABLE' : 'DEDUPE_FAILED'
      error.status = response.status
      throw error
    }
    const body = await response.json()
    const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
    return items.some(item => doiEqual(item?.data?.DOI, doi))
  }

  /**
   * @param {Array<Record<string, any>>} refs
   * @param {string} collectionId
   */
  async function save(refs, collectionId) {
    if (!collectionId) throw new Error('未选择分类')
    await ping()
    /** @type {{ id: string, reason: string }[]} */
    const skipped = []
    /** @type {{ id: string, reason: string }[]} */
    const failed = []
    /** @type {{ id: string, reason: string }[]} */
    const warnings = []
    /** @type {Array<Record<string, any>>} */
    const pending = []
    let warned = false
    for (const ref of refs) {
      if (ref.doi) {
        try {
          if (await findByDoi(ref.doi)) {
            skipped.push({ id: ref.id, reason: '已在库' })
            continue
          }
        } catch (error) {
          if (error?.code === 'DEDUPE_UNAVAILABLE') {
            if (!warned) {
              warned = true
              warnings.push({
                id: ref.id,
                reason: 'Zotero 的本地 API 未开启，这次跳过了查重，可能新建重复条目；可在 Zotero 设置 → 高级 里允许其他应用与本机 Zotero 通信',
              })
            }
          } else {
            failed.push({ id: ref.id, reason: error instanceof Error ? error.message : '查重失败' })
            continue
          }
        }
      }
      pending.push(ref)
    }
    if (pending.length === 0) return { saved: [], skipped, failed, warnings }

    const sessionID = `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const items = []
    /** @type {Map<string, Record<string, any>>} */
    const metas = new Map()
    for (const ref of pending) {
      // The enricher already resolved this row for the sidebar; reuse it so the
      // written entry matches what the user saw, and only look up on a miss.
      const cached = ref.resolved && typeof ref.resolved === 'object' && Object.keys(ref.resolved).length > 0
      const meta = cached ? ref.resolved : await resolveMetadata(ref, { fetch: fetchImpl })
      metas.set(ref.id, meta)
      items.push(toConnectorItem(ref, meta))
    }
    const created = await postJson('/connector/saveItems', { sessionID, items })
    if (created.status !== 201 && created.status !== 200) {
      for (const ref of pending) failed.push({ id: ref.id, reason: created.text || `保存失败 ${created.status}` })
      return { saved: [], skipped, failed, warnings }
    }
    const moved = await postJson('/connector/updateSession', { sessionID, target: collectionId })
    if (moved.status !== 200) {
      for (const ref of pending) failed.push({ id: ref.id, reason: moved.text || '没能放进所选分类' })
      return { saved: [], skipped, failed, warnings }
    }

    /** @type {{ id: string }[]} */
    const saved = []
    for (const ref of pending) {
      try {
        const bytes = await loadPdf(ref)
        if (bytes) await postBytes('/connector/saveAttachment', attachmentMeta(sessionID, ref, metas.get(ref.id)), bytes)
        if (ref.html) {
          const snap = await postJson('/connector/saveSingleFile', {
            sessionID,
            url: ref.url,
            title: ref.title,
            snapshotContent: ref.html,
            items: [{ id: ref.id }],
          })
          if (snap.status !== 201 && snap.status !== 200) {
            throw new Error(snap.text || '网页快照没有保存')
          }
        }
        saved.push({ id: ref.id })
      } catch (error) {
        failed.push({ id: ref.id, reason: error instanceof Error ? error.message : '附件保存失败' })
      }
    }
    return { saved, skipped, failed, warnings }
  }

  /**
   * @param {string} path
   * @param {Record<string, unknown>} json
   */
  async function postJson(path, json) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { ...connectorHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(json),
    })
    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    return { status: response.status, text, data }
  }

  /**
   * @param {string} path
   * @param {Record<string, string>} metadata
   * @param {Uint8Array} bytes
   */
  async function postBytes(path, metadata, bytes) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...connectorHeaders(),
        'content-type': 'application/pdf',
        'x-metadata': JSON.stringify(metadata),
      },
      body: bytes,
    })
    const text = await response.text()
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(text || `附件保存失败 ${response.status}`)
    }
  }

  /**
   * Bytes for the row's PDF. A local file is read; otherwise the row's own
   * `pdfUrl`, or one the plugin can find for it, is downloaded.
   * @param {Record<string, any>} ref
   */
  async function loadPdf(ref) {
    if (ref.pdfPath) {
      const bytes = new Uint8Array(await read(ref.pdfPath))
      if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDF 超过 20MB')
      return bytes
    }
    const url = isPublicHttpUrl(ref.pdfUrl ?? '') ? ref.pdfUrl : discoverPdfUrl(ref)
    if (!url || !isPublicHttpUrl(url)) return null
    const response = await fetchImpl(url)
    if (!response.ok) throw new Error(`PDF 下载失败 ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDF 超过 20MB')
    if (bytes.byteLength < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      throw new Error('下载到的不是 PDF')
    }
    return bytes
  }
}

/**
 * Find an open PDF for a row that has none: an arXiv id (directly, or inside a
 * `10.48550/arXiv.…` DOI) resolves to the arXiv PDF, and a converted page often
 * still carries its own PDF link.
 * @param {Record<string, any>} ref
 * @returns {string}
 */
export function discoverPdfUrl(ref) {
  const arxiv = typeof ref.arxiv === 'string' && ref.arxiv
    ? ref.arxiv
    : (/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})$/i.exec(String(ref.doi ?? ''))?.[1] ?? '')
  if (/^\d{4}\.\d{4,5}$/.test(arxiv)) return `https://arxiv.org/pdf/${arxiv}.pdf`

  const haystack = `${ref.html ?? ''}\n${ref.excerpt ?? ''}`
  const meta = /citation_pdf_url["'\s]+content=["']([^"']+\.pdf[^"']*)/i.exec(haystack)?.[1]
    ?? /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)/i.exec(haystack)?.[1]
  const href = /(?:href=["']|https?:\/\/)([^"'\s>]+\.pdf(?:\?[^"'\s>]*)?)/i.exec(haystack)?.[1]
  const candidate = meta ?? href
  if (!candidate) return ''
  try {
    return new URL(candidate, ref.url || undefined).href
  } catch {
    return ''
  }
}

/**
 * @param {string} value
 */
export function isPublicHttpUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) return false
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return false
  const octets = host.split('.').map(part => Number(part))
  if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false
  return true
}

/**
 * @param {Record<string, any>} ref
 * @param {Record<string, any>} meta
 */
export function toConnectorItem(ref, meta) {
  const item = {
    id: ref.id,
    itemType: meta.itemType || (ref.kind === 'page' ? 'webpage' : 'journalArticle'),
    title: meta.title || ref.title || ref.url || ref.pdfPath || '未命名',
  }
  if (Array.isArray(meta.creators) && meta.creators.length > 0) item.creators = meta.creators
  else if (ref.authors) item.creators = [{ creatorType: 'author', firstName: '', lastName: ref.authors }]
  const date = meta.date || ref.year
  if (date) item.date = date
  const doi = meta.DOI || ref.doi
  if (doi) item.DOI = doi
  const url = meta.url || ref.url
  if (url) item.url = url
  const abstract = meta.abstractNote || ref.abstract
  if (abstract) item.abstractNote = abstract
  if (meta.publicationTitle) item.publicationTitle = meta.publicationTitle
  if (meta.volume) item.volume = meta.volume
  if (meta.issue) item.issue = meta.issue
  if (meta.pages) item.pages = meta.pages
  return item
}

function connectorHeaders() {
  return {
    'X-Zotero-Connector-API-Version': '3',
    'Zotero-Allowed-Request': '1',
  }
}

/**
 * @param {string} sessionID
 * @param {{ id: string, title?: string, url?: string }} ref
 * @param {Record<string, any>} [meta]
 */
function attachmentMeta(sessionID, ref, meta) {
  return {
    sessionID,
    parentItemID: ref.id,
    title: meta?.title || ref.title || 'PDF',
    url: ref.url || '',
  }
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function doiEqual(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
}
