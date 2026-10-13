import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { handleHttp } from './api.js'
import { createEnricher } from './enrich.js'
import { createIgnoredStore } from './ignored.js'
import { createPending, onSessionEvent } from './ingest.js'
import { createReplay } from './replay.js'
import { extractPdfText, loadPdfSource, DEFAULT_MAX_CHARS, DEFAULT_MAX_PAGES } from './pdf.js'
import { createProposer } from './propose.js'
import { createStore } from './store.js'
import { createZotero } from './zotero.js'

export const name = 'refs2zotero'

export const inject = ['webServer']

/** Connector port is part of the Zotero desktop protocol. */
export const ZOTERO_BASE_URL = 'http://127.0.0.1:23119'

interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServer {
  register: (spec: RouteSpec) => () => void
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: Record<string, unknown>, value: Record<string, unknown>) => Array<{ type: 'text', text: string }>
  }
  execute: (args: Record<string, unknown>, exec: { signal?: AbortSignal }) => Promise<Record<string, unknown>>
  timeoutMs?: number
}

interface ToolsService {
  register: (definition: ToolDefinition) => () => void
}

interface LlmService {
  stream: (options: Record<string, unknown>) => AsyncIterable<{ type?: string, text?: string, reason?: { kind?: string } }>
}

type SessionRef = { id?: unknown }

type SessionEvent = { type?: string, data?: Record<string, unknown> }

/** The session store, used to replay what a session already read. */
interface SessionsService {
  list: () => SessionRef[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'session/event'(session: SessionRef, event: SessionEvent): void
    'session/disposed'(session: SessionRef): void
    'session/created'(session: SessionRef): void
  }
}

/**
 * The `read_pdf` tool the plugin adds to the session: the harness's own `read`
 * refuses binary files and its `web_fetch` refuses `application/pdf`, so a
 * plugin-owned reader is the only way an assistant can actually read a paper.
 */
export const READ_PDF_TOOL: ToolDefinition = {
  name: 'read_pdf',
  description: [
    'Read a PDF and return its text.',
    'Use this instead of `read` (which refuses binary files) and instead of `web_fetch` (which refuses application/pdf).',
    'Pass `url` for a public http(s) PDF or `path` for one already on disk; a downloaded PDF is cached to a local file and that path is reported in the result.',
  ].join(' '),
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      url: { type: 'string', description: 'Public http(s) URL of the PDF.' },
      path: { type: 'string', description: 'Absolute path of a local PDF.' },
      maxPages: { type: 'integer', description: `Pages to read. Defaults to ${DEFAULT_MAX_PAGES}.` },
      maxChars: { type: 'integer', description: `Characters to return. Defaults to ${DEFAULT_MAX_CHARS}.` },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'cachedPath', 'pages', 'readPages', 'text'],
      properties: {
        source: { type: 'string' },
        cachedPath: { type: 'string' },
        pages: { type: 'integer' },
        readPages: { type: 'integer' },
        text: { type: 'string' },
      },
    },
    render: (args, value) => {
      const text = String(value.text ?? '')
      const header = `PDF ${value.source || args.url || args.path} -> ${value.cachedPath || args.path || ''}`
      const meta = `${value.pages} pages (read ${value.readPages})`
      return [{ type: 'text', text: `${header}\n${meta}\n\n${text}` }]
    },
  },
  timeoutMs: 180_000,
  async execute(args, exec) {
    exec.signal?.throwIfAborted()
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    if (!url && !path) throw new Error('read_pdf 需要 url 或 path')
    const loaded = await loadPdfSource(url ? { url } : { path })
    const extracted = await extractPdfText(loaded.bytes, {
      maxPages: typeof args.maxPages === 'number' ? args.maxPages : DEFAULT_MAX_PAGES,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : DEFAULT_MAX_CHARS,
    })
    if (extracted.text.trim().length === 0) throw new Error('这个 PDF 里没有可提取的文字（可能是扫描件）')
    return {
      source: loaded.url || loaded.path,
      cachedPath: loaded.path,
      pages: extracted.pages,
      readPages: extracted.readPages,
      text: extracted.text,
    }
  },
}

/**
 * @param ctx Host context. `webServer` is ready because of `inject`.
 */
export function apply(ctx: Context): void {
  const store = createStore()
  const pending = createPending()
  const enricher = createEnricher(store)
  const zotero = createZotero({ baseUrl: ZOTERO_BASE_URL })
  const host = ctx as Context & { webServer: WebServer }
  // `ctx.tools` (property access) throws unless the service is in `inject`;
  // `ctx.get` is the accessor that returns undefined for an absent service.
  const resolve = <T>(name: string): T | undefined => (ctx as unknown as { get: <U>(n: string) => U | undefined }).get<T>(name)
  const tools = resolve<ToolsService>('tools')
  const llm = resolve<LlmService>('llm')
  const sessions = resolve<SessionsService>('sessions')
  const proposer = createProposer({ stream: llm ? options => llm.stream(options) : undefined })
  const ignored = createIgnoredStore()
  const replay = createReplay({ store, pending, enricher, ignored })

  if (tools) {
    // Registered as an effect so unloading this plugin also unregisters the
    // tool. A rejected definition must not take the sidebar down with it: the
    // reader is an extra, the list is the product.
    ctx.effect(() => {
      try {
        return tools.register(READ_PDF_TOOL)
      } catch {
        return () => {}
      }
    })
  }
  ctx.on('session/event', (session: SessionRef, event: SessionEvent) => {
    const sessionId = String(session.id)
    const ref = onSessionEvent(store, pending, session, event)
    if (!ref) return
    // A row with an identifier gets its canonical record in the background, so
    // the sidebar can show the publisher's title without a save round trip.
    if (ref.doi || ref.arxiv) {
      void enricher.resolve(sessionId, ref).catch(() => { /* keep the harvested fields */ })
      return
    }
    // No identifier: ask the model for a record, but keep it a suggestion until
    // the user confirms it in the sidebar.
    if (proposer.available && ref.excerpt && ref.excerpt.length >= 40 && !ref.proposed) {
      void proposer.propose(ref)
        .then(proposed => { if (proposed) store.propose(sessionId, ref.id, proposed) })
        .catch(() => { /* a failed proposal changes nothing */ })
    }
  })
  ctx.on('session/disposed', (session: SessionRef) => {
    store.drop(String(session.id))
  })
  // The route is what the sidebar talks to: register it before any optional
  // work, so a problem elsewhere can never leave the page without an endpoint.
  const apiHandler = (req: IncomingMessage, res: ServerResponse): void => {
    void handleHttp(req, res, { store, zotero, proposer, ignored })
  }
  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/dsh-refs2zotero/api',
    handler: apiHandler,
  }))
  // Compatibility shim for a browser still running the pre-rename bundle: it
  // polls `/zotero-refs/api`, and a route that no longer exists answers 405 with
  // an empty body, which the page reports as "Unexpected end of JSON input".
  // Remove once no page can predate the rename.
  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/zotero-refs/api',
    handler: apiHandler,
  }))
  // Sessions that already exist when this plugin mounts (or remounts) get their
  // list rebuilt from the log; new ones are replayed as soon as they appear.
  // Replay is best-effort by design: a session whose log is not readable yet
  // must not stop the plugin from loading.
  try {
    replay.all(sessions)
  } catch {
    /* the list rebuilds from live events and from the next session/created */
  }
  ctx.on('session/created', (session: SessionRef) => { replay.one(session) })
}
