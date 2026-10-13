const DOI_RE = /10\.\d{4,9}\/[^\s"'<>[\]{}?#]+/i
const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5})(?:v\d+)?/i
/**
 * How much of a plain text file counts as "the record itself". A note or a
 * source file that merely *mentions* a paper must not be collected, but a
 * converted record keeps its title/authors/DOI at the top.
 */
const TEXT_HEAD_CHARS = 2000

/**
 * ...and the labelled fields must be the first thing in the file. A source file
 * that happens to contain `title:` and `doi:` lines further down is not a
 * record; a converted record keeps its title/authors at the top.
 */
const TEXT_HEAD_LINES = 12

/** The `read` tool wraps its output in these tags and numbers every line. */
const READ_ENVELOPE_RE = /^\s*<path>([\s\S]*?)<\/path>\s*<type>([\s\S]*?)<\/type>\s*<content>\s*([\s\S]*?)\s*<\/content>\s*$/i

/** A `Title:` label, with or without a markdown heading or emphasis around it. */
const TITLE_LABEL_RE = /^[#>\s*]*\**\s*title\s*\**\s*[:：=]\s*(.+)$/im

/**
 * Source/script files are never bibliographic records, however record-shaped
 * their lines (`title:`, `doi:` …) happen to be — reading a code file at an
 * offset can land right on such keys.
 */
const CODE_EXT_RE = /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|json|ya?ml|toml|xml|css|scss|less|html?|vue|svelte|sql|r|m|swift|kt|dart|lua|pl|exs?|erl|hs|scala|fsx?|ini|conf|lock)$/i

/**
 * @param {string} value
 * @returns {string}
 */
export function extractDoi(value) {
  if (typeof value !== 'string') return ''
  const match = DOI_RE.exec(value)
  if (!match) return ''
  return match[0].replace(/[).,;]+$/g, '')
}

/**
 * @param {string} value
 * @returns {string}
 */
export function extractArxiv(value) {
  if (typeof value !== 'string') return ''
  const match = ARXIV_RE.exec(value)
  return match ? match[1] : ''
}

/**
 * Separate a `read` result's envelope from the file's own text. Without this the
 * `<path>…</path>` line becomes the title and an unrelated file can look like a
 * bibliographic record.
 * @param {string} text
 * @returns {{ path: string, body: string }}
 */
export function stripReadEnvelope(text) {
  if (typeof text !== 'string') return { path: '', body: '' }
  const match = READ_ENVELOPE_RE.exec(text)
  if (!match) return { path: '', body: text }
  const body = match[3]
    .replace(/^\s*\d+:\s?/gm, '')
    .replace(/\n*\((?:Showing lines|End of file|Output capped)[^)]*\)\s*$/i, '')
  return { path: match[1].trim(), body: body.trim() }
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractTitle(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  const tag = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(text)
  if (tag) return cleanLine(tag[1])
  // arXiv and publisher markdown label the real title; a bare heading on the same
  // page is often a breadcrumb ("Computer Science > Computation and Language").
  const labelled = TITLE_LABEL_RE.exec(text)
  if (labelled) {
    // An explicit label wins even when the value is short: falling through would
    // return the literal "Title: …" line as the title.
    let value = cleanLine(labelled[1]).replace(/\*+$/, '').trim()
    // BibTeX writes fields as `title = {…},`.
    const braced = /^\{(.*)\},?$/.exec(value)
    if (braced) value = braced[1].trim()
    else value = value.replace(/,\s*$/, '').trim()
    if (value.length > 0) return value.slice(0, 300)
  }
  for (const match of text.matchAll(/^#{1,3}\s+(.{1,300})$/gm)) {
    const candidate = cleanLine(match[1])
    if (usableTitle(candidate)) return candidate
  }
  for (const line of text.split('\n')) {
    const trimmed = cleanLine(line)
    if (trimmed.length < 8) continue
    if (/^(abstract|摘要)\b/i.test(trimmed)) continue
    if (!/[A-Za-z\u4e00-\u9fff]/.test(trimmed)) continue
    if (!usableTitle(trimmed)) continue
    return trimmed.slice(0, 300)
  }
  return ''
}

/**
 * Reject navigation chrome that a markdown conversion leaves behind: a bare
 * link, a menu label, or a breadcrumb. A page such as a publisher article page
 * puts several of these above the real title.
 * @param {string} value
 */
function usableTitle(value) {
  if (value.length < 8) return false
  if (/^\[[^\]]*\]\([^)]*\)$/.test(value)) return false
  if (/^(skip to|advertisement|search|menu|browse|donate|log in|sign in|share|cite|toggle)/i.test(value)) return false
  // A converted page often leaves a bare identifier where a title would be,
  // and a `read` result can leave its own envelope behind.
  if (value.startsWith('<')) return false
  if (/^(?:https?:\/\/|www\.)/i.test(value)) return false
  if (/^10\.\d{4,9}\//.test(value)) return false
  if (/^arxiv[:\s]/i.test(value)) return false
  return true
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractAbstract(text) {
  if (typeof text !== 'string') return ''
  const match = /(?:abstract|摘要)\s*[:：]?\s*([\s\S]{40,1600})/i.exec(text)
  if (!match) return ''
  // A converted page puts the section heading between "Abstract" and its body.
  const body = match[1]
    .split('\n')
    .filter(line => !/^\s*#{1,6}\s/.test(line))
    .join('\n')
    .split(/\n{2,}/)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return body.length < 40 ? '' : body.slice(0, 800)
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractAuthors(text) {
  if (typeof text !== 'string') return ''
  const match = /^authors?\s*[:：]\s*(.{3,300})$/im.exec(text)
  return match ? cleanLine(match[1]) : ''
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractYear(text) {
  if (typeof text !== 'string') return ''
  const match = /\b(19|20)\d{2}\b/.exec(text)
  return match ? match[0] : ''
}

/**
 * Turn one successful tool call into a reference, or null when it is not a paper.
 *
 * The plugin reads references out of *whatever form the assistant read*: a PDF
 * it fetched with the plugin's own `read_pdf` tool, a `.pdf` path, or a page /
 * text result that carries an identifier, an abstract, or scholarly labels.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {string} text
 * @returns {import('./types.js').Reference | null}
 */
export function collectRef(toolName, args, text) {
  const body = typeof text === 'string' ? text : ''
  if (toolName === 'read_pdf') {
    return fromPdfRead(args, body)
  }
  if (toolName === 'web_fetch') {
    const url = typeof args.url === 'string' ? args.url : ''
    if (url.length === 0) return null
    return fromWeb(url, body)
  }
  if (toolName === 'read') {
    const filePath = typeof args.file_path === 'string' ? args.file_path : ''
    if (!filePath.toLowerCase().endsWith('.pdf')) return fromTextPage(filePath, body)
    return fromPdfPath(filePath, body)
  }
  return null
}

/**
 * A PDF the plugin itself fetched and read. The tool's rendered text starts with
 * `PDF <source> -> <cached path>`, which is how the row learns the local file to
 * hand to Zotero without downloading the same bytes twice.
 * @param {Record<string, unknown>} args
 * @param {string} text
 */
function fromPdfRead(args, text) {
  const header = /^PDF\s+(\S+)\s*->\s*(.+?)\s*$/m.exec(text)
  const source = typeof args.url === 'string' && args.url ? args.url : (typeof args.path === 'string' ? args.path : (header ? header[1] : ''))
  const cached = header && header[2] ? header[2] : (typeof args.path === 'string' ? args.path : '')
  const isUrl = /^https?:\/\//i.test(source)
  // Parse the document, not the tool's own envelope.
  const body = stripPdfHeader(text)
  const doi = extractDoi(body)
  const arxiv = extractArxiv(source) || extractArxiv(body)
  const url = isUrl ? source : ''
  const pdfPath = isUrl ? cached : (cached || source)
  return {
    id: stableId({ doi, arxiv, url, path: isUrl ? '' : pdfPath }),
    title: extractTitle(body) || basename(pdfPath || url),
    authors: extractAuthors(body),
    year: extractYear(body) || yearFromArxiv(arxiv),
    doi,
    arxiv,
    url,
    abstract: extractAbstract(body),
    pdfUrl: isUrl ? source : (arxiv ? `https://arxiv.org/pdf/${arxiv}.pdf` : ''),
    pdfPath,
    html: '',
    excerpt: excerptOf(body),
    why: '助手读了这篇 PDF',
    kind: 'pdf',
  }
}

/**
 * The `read_pdf` render starts with `PDF <source> -> <cached path>` and a page
 * count. Neither is part of the document.
 * @param {string} text
 */
export function stripPdfHeader(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/^PDF\s+\S+\s*->\s*.*$/m, '')
    .replace(/^\d+\s+pages?\b.*$/m, '')
    .trim()
}

/**
 * A text file the assistant read that looks like a scholarly record: it needs an
 * identifier or scholarly labels. Prose that merely mentions "Abstract:" is not
 * enough, or every note file would land in the list.
 * @param {string} filePath
 * @param {string} text
 */
function fromTextPage(filePath, rawText) {
  const { path: envelopePath, body } = stripReadEnvelope(rawText)
  const file = envelopePath || filePath
  if (CODE_EXT_RE.test(file)) return null
  const head = body.split('\n').slice(0, TEXT_HEAD_LINES).join('\n')
  const window = body.slice(0, TEXT_HEAD_CHARS)
  const doi = extractDoi(head) || extractDoi(window)
  const arxiv = extractArxiv(head) || extractArxiv(window)
  const abstract = extractAbstract(head)
  // A plain text file counts only when it *is* a record: labelled fields at the
  // very top plus something that identifies it. A source file or a note that
  // merely mentions a DOI or a `title:` further down must not become a reference.
  if (!looksScholarly(head)) return null
  if (!doi && !arxiv && abstract.length < 40 && !/\b(19|20)\d{2}\b/.test(head)) return null
  return {
    id: stableId({ doi, arxiv, url: '', path: file }),
    title: extractTitle(head) || basename(file),
    authors: extractAuthors(head),
    year: extractYear(head),
    doi,
    arxiv,
    url: '',
    abstract,
    pdfUrl: arxiv ? `https://arxiv.org/pdf/${arxiv}.pdf` : '',
    pdfPath: '',
    html: '',
    excerpt: excerptOf(body),
    why: '助手读了这篇文本文件',
    kind: 'page',
  }
}

/**
 * Labels a converted scholarly record carries but an ordinary page does not.
 * Two distinct labels are required, so a stray "Volume" in prose cannot pull a
 * document into the list.
 * @param {string} text
 */
export function looksScholarly(text) {
  if (typeof text !== 'string') return false
  const labels = ['title', 'authors?', 'doi', 'arxiv', 'journal', 'publication', 'volume', 'issue', 'issn', 'pages']
  let hits = 0
  for (const label of labels) {
    if (new RegExp(`^\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?\\s*${label}\\b`, 'im').test(text)) hits += 1
    if (hits >= 2) return true
  }
  return false
}

/**
 * @param {string} url
 * @param {string} text
 */
function fromWeb(url, text) {
  const doi = extractDoi(text) || extractDoi(decodeURIComponentSafe(url))
  const arxiv = extractArxiv(url) || extractArxiv(text)
  const pdfish = /\.pdf(?:$|\?)/i.test(url) || /arxiv\.org\/pdf\//i.test(url)
  const abstract = extractAbstract(text)
  if (!pdfish && !doi && !arxiv && abstract.length < 40 && !looksScholarly(text)) return null
  const title = extractTitle(text) || url
  const html = /<html[\s>]/i.test(text) || /<!doctype html/i.test(text) ? text : ''
  const pdfUrl = pdfish ? url : (arxiv ? `https://arxiv.org/pdf/${arxiv}.pdf` : '')
  return {
    id: stableId({ doi, arxiv, url }),
    title,
    authors: extractAuthors(text),
    year: extractYear(text) || yearFromArxiv(arxiv),
    doi,
    arxiv,
    url,
    abstract,
    pdfUrl,
    pdfPath: '',
    html,
    excerpt: excerptOf(text),
    why: pdfish ? '助手抓取了这篇 PDF' : '助手抓取了这篇文章网页',
    kind: pdfish ? 'pdf' : (arxiv ? 'pdf' : 'page'),
  }
}

/**
 * Keep a bounded slice of what was read: the model proposer reads this, and it
 * is never sent to the browser.
 * @param {string} text
 */
export function excerptOf(text) {
  if (typeof text !== 'string') return ''
  return text.trim().slice(0, 8000)
}

/**
 * @param {string} value
 */
function basename(value) {
  return String(value).split(/[/\\]/).pop() || String(value)
}

/**
 * @param {string} filePath
 * @param {string} text
 */
function fromPdfPath(filePath, text) {
  const doi = extractDoi(text)
  const arxiv = extractArxiv(text)
  const name = filePath.split(/[/\\]/).pop() || filePath
  return {
    id: stableId({ doi, arxiv, url: '', path: filePath }),
    title: extractTitle(text) || name,
    authors: extractAuthors(text),
    year: extractYear(text) || yearFromArxiv(arxiv),
    doi,
    arxiv,
    url: '',
    abstract: extractAbstract(text),
    pdfUrl: arxiv ? `https://arxiv.org/pdf/${arxiv}.pdf` : '',
    pdfPath: filePath,
    html: '',
    excerpt: excerptOf(text),
    why: '助手读了这篇 PDF 文件',
    kind: 'pdf',
  }
}

/**
 * @param {{ doi?: string, arxiv?: string, url?: string, path?: string }} parts
 */
function stableId(parts) {
  if (parts.doi) return `doi:${parts.doi.toLowerCase()}`
  if (parts.arxiv) return `arxiv:${parts.arxiv}`
  if (parts.path) return `path:${parts.path}`
  return `url:${parts.url}`
}

/**
 * @param {string} arxiv
 */
function yearFromArxiv(arxiv) {
  if (!/^\d{4}\./.test(arxiv)) return ''
  const yy = Number(arxiv.slice(0, 2))
  return String(yy >= 91 ? 1900 + yy : 2000 + yy)
}

/**
 * @param {string} value
 */
function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * @param {string} value
 */
function cleanLine(value) {
  return value.replace(/\s+/g, ' ').trim()
}

const ARXIV_LINK_RE = /(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:\s*)(\d{4}\.\d{4,5})(?:v\d+)?/gi
const DOI_LINK_RE = /doi\.org\/(10\.\d{4,9}\/[^\s"'<>()[\]`]+)/gi

/**
 * Extract the references a chat message itself cites: a paper named through an
 * `arxiv.org/abs/…` or `doi.org/…` link, or an `arXiv:<id>` label.
 *
 * Only these high-precision forms are collected. A bare `10.xxxx/…` in prose,
 * a code snippet, or the port of some service is not a citation — and this
 * session's own compaction summary is a user message that replays the whole
 * history, so a loose identifier scan would turn it into a flood of junk rows.
 * Blogs and other pages are still collected when they are actually fetched
 * (`web_fetch`), where the page text yields a real title.
 *
 * @param {string} text
 * @returns {Array<import('./types.js').Reference>}
 */
export function collectFromMessage(text, why = '对话里引用') {
  if (typeof text !== 'string' || text.length === 0) return []
  // A code block or inline span is quoted content, not a citation: test
  // fixtures and pasted commands must not become rows.
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]+`/g, ' ')
  const refs = []
  const seen = new Set()
  const push = ref => {
    if (!ref || seen.has(ref.id)) return
    seen.add(ref.id)
    refs.push(ref)
  }

  for (const match of prose.matchAll(ARXIV_LINK_RE)) {
    push(arxivMessageRef(match[1], why))
  }
  for (const match of prose.matchAll(DOI_LINK_RE)) {
    const doi = match[1].replace(/[?*$.,;:)\)`]+$/g, '')
    // Normalise the arXiv DOI form so an arxiv link and its doi.org twin land
    // on the same row.
    const arxivDoi = /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})$/i.exec(doi)
    if (arxivDoi) {
      push(arxivMessageRef(arxivDoi[1], why))
      continue
    }
    if (!/^10\.\d{4,9}\//.test(doi)) continue
    const suffix = doi.slice(doi.indexOf('/') + 1)
    if (suffix.length < 3) continue
    // The rest of the 10.48550/arxiv… family and placeholders like
    // `10.48550/arxiv`, `arxiv.x`, or `10.1000/xxx` are not citations.
    if (/^arxiv\b/i.test(suffix) || /xxx|\.\.\./i.test(suffix)) continue
    push({
      id: `doi:${doi.toLowerCase()}`,
      title: '',
      authors: '',
      year: '',
      doi,
      arxiv: '',
      url: '',
      abstract: '',
      pdfUrl: '',
      pdfPath: '',
      html: '',
      excerpt: '',
      kind: 'page',
      fromMessage: true,
      why,
    })
  }
  return refs
}

/**
 * @param {string} arxiv
 * @param {string} why
 */
function arxivMessageRef(arxiv, why) {
  const doi = `10.48550/arxiv.${arxiv}`
  return {
    id: `doi:${doi.toLowerCase()}`,
    title: '',
    authors: '',
    year: yearFromArxiv(arxiv),
    doi,
    arxiv,
    url: `https://arxiv.org/abs/${arxiv}`,
    abstract: '',
    pdfUrl: `https://arxiv.org/pdf/${arxiv}.pdf`,
    pdfPath: '',
    html: '',
    excerpt: '',
    kind: 'pdf',
    fromMessage: true,
    why,
  }
}
