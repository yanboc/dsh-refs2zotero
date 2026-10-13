const DEFAULT_SYSTEM = [
  'You extract a bibliographic record from text an AI assistant read.',
  'Answer with one JSON object and nothing else. No prose, no code fences.',
  'Keys: title, authors (array of "Family, Given"), year, venue, itemType, doi, arxiv, url, abstract.',
  'itemType is one of: journalArticle, conferencePaper, preprint, book, thesis, report, webpage.',
  'Use only what the text supports. Use "" for anything the text does not state.',
  'Never invent an author, year, venue, or identifier.',
  'Answer immediately with the JSON object; do not reason out loud first.',
].join('\n')

/**
 * Ask a model to read a harvested excerpt and propose a bibliographic record.
 *
 * The proposal is advisory: it is stored beside the row and only becomes the
 * written record after the user confirms it in the sidebar.
 *
 * @param {{ stream?: (options: Record<string, unknown>) => AsyncIterable<any>, provider?: string, model?: string, system?: string, maxTokens?: number, timeoutMs?: number, maxInputChars?: number, trace?: (line: string) => void }} [deps]
 */
export function createProposer(deps = {}) {
  const stream = deps.stream
  const provider = deps.provider ?? 'deepseek-official'
  const model = deps.model ?? 'deepseek-flash'
  const system = deps.system ?? DEFAULT_SYSTEM
  // Reasoning models spend most of the budget thinking; the JSON comes after.
  const maxTokens = deps.maxTokens ?? 4000
  const timeoutMs = deps.timeoutMs ?? 90_000
  const maxInputChars = deps.maxInputChars ?? 6000

  return {
    get available() {
      return typeof stream === 'function'
    },
    /**
     * @param {{ title?: string, url?: string, doi?: string, arxiv?: string, excerpt?: string, abstract?: string }} ref
     * @param {{ sessionId?: string }} [options]
     * @returns {Promise<Record<string, unknown> | null>} Zotero-shaped record, or null when unusable
     */
    async propose(ref, options = {}) {
      if (typeof stream !== 'function') throw new Error('宿主没有可用的模型服务')
      const excerpt = String(ref.excerpt || ref.abstract || '').slice(0, maxInputChars)
      if (excerpt.trim().length < 40) throw new Error('这一行没有足够的正文可以让模型读')
      const message = {
        role: 'user',
        content: [{ type: 'text', text: buildPrompt(ref, excerpt) }],
        source: { kind: 'dsh-refs2zotero-propose' },
      }
      const signal = AbortSignal.timeout(timeoutMs)
      let text = ''
      let reasoning = ''
      const kinds = []
      for await (const chunk of stream({
        provider,
        model,
        system,
        messages: [message],
        maxTokens,
        signal,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      })) {
        kinds.push(chunk?.type)
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        // A reasoning model may put the only usable output in its reasoning
        // channel; prefer the answer, fall back to the thinking.
        else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning += chunk.text
        if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') throw new Error('模型调用失败')
      }
      const record = parseRecord(text) ?? parseRecord(reasoning)
      if (!record && deps.trace) {
        deps.trace(`propose: chunks=${kinds.length} textLen=${text.length} reasoningLen=${reasoning.length} head=${JSON.stringify((text || reasoning).slice(0, 160))}`)
      }
      return record
    },
  }
}

/**
 * @param {{ title?: string, url?: string, doi?: string, arxiv?: string }} ref
 * @param {string} excerpt
 */
export function buildPrompt(ref, excerpt) {
  const hints = [
    ref.title ? `Harvested title: ${ref.title}` : '',
    ref.url ? `Source URL: ${ref.url}` : '',
    ref.doi ? `Harvested DOI: ${ref.doi}` : '',
    ref.arxiv ? `Harvested arXiv id: ${ref.arxiv}` : '',
  ].filter(Boolean)
  return [
    'Bibliographic record for the document below.',
    ...hints,
    '',
    'Document text:',
    excerpt,
  ].join('\n')
}

/**
 * Parse the model's answer defensively: models wrap JSON in prose or fences even
 * when told not to. Returns null when nothing usable came back.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
export function parseRecord(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = {}
  if (str(raw.title)) record.title = str(raw.title)
  const creators = mapAuthors(raw.authors)
  if (creators.length > 0) record.creators = creators
  const year = str(raw.year)
  if (/^\d{4}$/.test(year)) record.date = year
  if (str(raw.venue)) record.publicationTitle = str(raw.venue)
  const itemType = str(raw.itemType)
  if (itemType) record.itemType = itemType
  const doi = str(raw.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  if (/^10\.\d{4,9}\//.test(doi)) record.DOI = doi
  const arxiv = str(raw.arxiv).replace(/^arxiv[:\s]*/i, '')
  if (/^\d{4}\.\d{4,5}$/.test(arxiv)) record.arxiv = arxiv
  if (/^https?:\/\//i.test(str(raw.url))) record.url = str(raw.url)
  if (str(raw.abstract)) record.abstractNote = str(raw.abstract)
  return Object.keys(record).length > 0 ? record : null
}

/**
 * @param {unknown} value
 */
function str(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {unknown} authors
 */
function mapAuthors(authors) {
  if (!Array.isArray(authors)) return []
  const creators = []
  for (const author of authors) {
    const name = str(author)
    if (!name) continue
    const [family, ...rest] = name.split(',').map(part => part.trim())
    creators.push({
      creatorType: 'author',
      firstName: rest.join(', '),
      lastName: family,
    })
  }
  return creators
}
