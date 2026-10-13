const TYPE_MAP = {
  'article-journal': 'journalArticle',
  article: 'journalArticle',
  'paper-conference': 'conferencePaper',
  book: 'book',
  report: 'report',
  thesis: 'thesis',
  webpage: 'webpage',
}

/**
 * Map CSL JSON into Zotero item fields. Missing inputs stay absent.
 * @param {Record<string, unknown>} csl
 * @returns {Record<string, unknown>}
 */
export function mapCsl(csl) {
  const item = {}
  const itemType = TYPE_MAP[typeof csl.type === 'string' ? csl.type : '']
  if (itemType) item.itemType = itemType
  if (typeof csl.title === 'string' && csl.title.trim()) item.title = csl.title.trim()
  const creators = mapCreators(csl.author)
  if (creators.length > 0) item.creators = creators
  const date = mapDate(csl.issued)
  if (date) item.date = date
  if (typeof csl.DOI === 'string' && csl.DOI.trim()) item.DOI = csl.DOI.trim()
  if (typeof csl.URL === 'string' && csl.URL.trim()) item.url = csl.URL.trim()
  if (typeof csl.abstract === 'string' && csl.abstract.trim()) item.abstractNote = csl.abstract.trim()
  const container = firstString(csl['container-title'])
  if (container) item.publicationTitle = container
  if (typeof csl.volume === 'string' && csl.volume) item.volume = csl.volume
  if (typeof csl.issue === 'string' && csl.issue) item.issue = csl.issue
  if (typeof csl.page === 'string' && csl.page) item.pages = csl.page
  return item
}

/**
 * Fill a reference from doi.org or the arXiv API. Network failure returns {}.
 * @param {{ doi?: string, arxiv?: string }} ref
 * @param {{ fetch: typeof fetch }} deps
 */
export async function resolveMetadata(ref, deps) {
  if (ref.doi) {
    const csl = await fetchDoi(ref.doi, deps.fetch)
    if (csl) return mapCsl(csl)
  }
  if (ref.arxiv) {
    const item = await fetchArxiv(ref.arxiv, deps.fetch)
    if (item) return item
  }
  return {}
}

/**
 * @param {string} xml
 * @returns {Record<string, unknown> | null}
 */
export function mapArxivAtom(xml) {
  const entry = /<entry\b[^>]*>([\s\S]*?)<\/entry>/i.exec(xml)
  if (!entry) return null
  const body = entry[1]
  const title = textTag(body, 'title')
  const summary = textTag(body, 'summary')
  const published = textTag(body, 'published')
  const names = [...body.matchAll(/<name>([^<]+)<\/name>/gi)].map(match => match[1].trim()).filter(Boolean)
  return mapArxiv({ title, summary, published, names })
}

/**
 * @param {string} doi
 * @param {typeof fetch} fetchImpl
 */
async function fetchDoi(doi, fetchImpl) {
  try {
    const response = await fetchImpl(`https://doi.org/${encodeURIComponent(doi)}`, {
      headers: { accept: 'application/vnd.citationstyles.csl+json' },
    })
    if (!response.ok) return null
    const json = await response.json()
    if (!json || typeof json !== 'object') return null
    return /** @type {Record<string, unknown>} */ (json)
  } catch {
    return null
  }
}

/**
 * @param {string} arxiv
 * @param {typeof fetch} fetchImpl
 */
async function fetchArxiv(arxiv, fetchImpl) {
  try {
    const response = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxiv)}`)
    if (!response.ok) return null
    return mapArxivAtom(await response.text())
  } catch {
    return null
  }
}

/**
 * @param {{ title?: string, summary?: string, published?: string, names?: string[] }} atom
 */
function mapArxiv(atom) {
  const item = { itemType: 'preprint' }
  if (atom.title) item.title = atom.title.replace(/\s+/g, ' ').trim()
  if (atom.summary) item.abstractNote = atom.summary.replace(/\s+/g, ' ').trim()
  if (atom.published) item.date = atom.published.slice(0, 10)
  const creators = (atom.names ?? []).map(name => ({ creatorType: 'author', lastName: name, firstName: '' }))
  if (creators.length > 0) item.creators = creators
  return item
}

/**
 * @param {unknown} authors
 */
function mapCreators(authors) {
  if (!Array.isArray(authors)) return []
  const creators = []
  for (const author of authors) {
    if (!author || typeof author !== 'object') continue
    const record = /** @type {Record<string, unknown>} */ (author)
    const lastName = typeof record.family === 'string' ? record.family : typeof record.literal === 'string' ? record.literal : ''
    const firstName = typeof record.given === 'string' ? record.given : ''
    if (!lastName && !firstName) continue
    creators.push({ creatorType: 'author', firstName, lastName })
  }
  return creators
}

/**
 * @param {unknown} issued
 */
function mapDate(issued) {
  if (!issued || typeof issued !== 'object') return ''
  const parts = /** @type {{ 'date-parts'?: unknown }} */ (issued)['date-parts']
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return ''
  const [year, month, day] = parts[0]
  if (typeof year !== 'number') return ''
  const bits = [String(year)]
  if (typeof month === 'number') bits.push(String(month).padStart(2, '0'))
  if (typeof day === 'number') bits.push(String(day).padStart(2, '0'))
  return bits.join('-')
}

/**
 * @param {unknown} value
 */
function firstString(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0].trim()
  return ''
}

/**
 * @param {string} xml
 * @param {string} tag
 */
function textTag(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return match ? match[1].replace(/\s+/g, ' ').trim() : ''
}
