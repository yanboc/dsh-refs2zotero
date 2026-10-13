import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { handleHttp } from '../src/api.js'
import { createEnricher } from '../src/enrich.js'
import { createPending, onSessionEvent } from '../src/ingest.js'
import { createStore } from '../src/store.js'
import { createZotero } from '../src/zotero.js'

/** The canonical record the publisher's DOI resolver would return. */
const CANONICAL_TITLE = 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding'
const cslFetch = async () => ({
  ok: true,
  json: async () => ({
    type: 'article-journal',
    title: CANONICAL_TITLE,
    author: [{ family: 'Devlin', given: 'Jacob' }],
    issued: { 'date-parts': [[2018, 10, 11]] },
    'container-title': 'arXiv',
    abstract: 'We introduce a new language representation model called BERT.',
  }),
})

/**
 * End-to-end over real sockets: session events in, the plugin's own HTTP route
 * in the middle, and a stand-in Zotero connector on the other side. Nothing is
 * stubbed except the desktop app itself, so the request order, headers, and
 * bodies are the ones the real connector would see.
 */

test('a page read in a session is saved into a chosen collection with its pdf', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-refs2zotero-e2e-'))
  const pdfPath = join(dir, 'bert.pdf')
  await writeFile(pdfPath, pdfBytes)

  const connector = await startFakeConnector({ libraryHasDoi: false })
  const store = createStore()
  const pending = createPending()
  const enricher = createEnricher(store, { fetch: cslFetch })
  const zotero = createZotero({ baseUrl: connector.baseUrl })
  const plugin = await startPluginServer({ store, zotero })

  try {
    deliverFetchedPage(store, pending)
    deliverReadPdf(store, pending, pdfPath)
    // The host half enriches every stored row that carries an identifier.
    await enricher.resolve('s-e2e', store.list('s-e2e')[0])

    // 1. The sidebar asks what this session collected.
    const listed = await postJson(plugin.url, { op: 'list', sessionId: 's-e2e' })
    assert.equal(listed.ok, true)
    assert.deepEqual(listed.refs.map(row => row.id), ['doi:10.48550/arxiv.1810.04805'])
    assert.equal(listed.refs[0].title, CANONICAL_TITLE)
    assert.equal(listed.refs[0].authors, 'Jacob Devlin')
    assert.equal(listed.refs[0].year, '2018')
    assert.equal(listed.refs[0].resolved, true)
    assert.equal(listed.refs[0].hasPdf, true)
    assert.equal(listed.refs[0].inLibrary, false)

    // 2. The sidebar asks for the collections to offer.
    const collections = await postJson(plugin.url, { op: 'collections' })
    assert.deepEqual(collections.collections, [{ id: 'C1', name: 'Deepseek Research', level: 1 }])

    // 3. The user picks the row and the collection, and writes.
    const saved = await postJson(plugin.url, {
      op: 'save',
      sessionId: 's-e2e',
      ids: ['doi:10.48550/arxiv.1810.04805'],
      collectionId: 'C1',
    })
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.saved, [{ id: 'doi:10.48550/arxiv.1810.04805' }])
    assert.deepEqual(saved.skipped, [])
    assert.deepEqual(saved.failed, [])

    // The list and collections reads above already talked to the connector;
    // the write phase is what this asserts.
    const calls = connector.calls().slice(3)
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
      'GET /connector/ping',
      'GET /api/users/0/items',
      'POST /connector/saveItems',
      'POST /connector/updateSession',
      'POST /connector/saveAttachment',
    ])
    for (const call of calls.slice(1)) {
      assert.equal(call.headers['x-zotero-connector-api-version'], '3')
    }
    assert.equal(calls[1].query.get('q').toLowerCase(), '10.48550/arxiv.1810.04805')
    assert.equal(calls[1].query.get('qmode'), 'everything')

    const saveItems = JSON.parse(calls[2].body)
    assert.match(saveItems.sessionID, /^dsh-/)
    assert.equal(saveItems.items.length, 1)
    assert.equal(saveItems.items[0].title, CANONICAL_TITLE)
    assert.equal(saveItems.items[0].DOI.toLowerCase(), '10.48550/arxiv.1810.04805')
    assert.deepEqual(saveItems.items[0].creators, [{ creatorType: 'author', firstName: 'Jacob', lastName: 'Devlin' }])

    const updateSession = JSON.parse(calls[3].body)
    assert.equal(updateSession.sessionID, saveItems.sessionID)
    assert.equal(updateSession.target, 'C1')
    assert.equal('note' in updateSession, false)

    assert.equal(calls[4].headers['content-type'], 'application/pdf')
    const meta = JSON.parse(calls[4].headers['x-metadata'])
    assert.equal(meta.sessionID, saveItems.sessionID)
    assert.equal(meta.parentItemID, 'doi:10.48550/arxiv.1810.04805')
    assert.equal(meta.title, CANONICAL_TITLE)
    assert.deepEqual(Buffer.from(calls[4].body, 'binary'), pdfBytes)
  } finally {
    await connector.close()
    await plugin.close()
  }
})

test('a row already in the library is reported as skipped and never re-saved', async () => {
  const connector = await startFakeConnector({ libraryHasDoi: true })
  const store = createStore()
  const pending = createPending()
  const enricher = createEnricher(store, { fetch: cslFetch })
  const zotero = createZotero({ baseUrl: connector.baseUrl })
  const plugin = await startPluginServer({ store, zotero })

  try {
    deliverFetchedPage(store, pending)
    await enricher.resolve('s-e2e', store.list('s-e2e')[0])
    const listed = await postJson(plugin.url, { op: 'list', sessionId: 's-e2e' })
    assert.equal(listed.refs[0].inLibrary, true)
    assert.equal(listed.refs[0].resolved, true)

    const saved = await postJson(plugin.url, {
      op: 'save',
      sessionId: 's-e2e',
      ids: ['doi:10.48550/arxiv.1810.04805'],
      collectionId: 'C1',
    })
    assert.deepEqual(saved.saved, [])
    assert.deepEqual(saved.skipped, [{ id: 'doi:10.48550/arxiv.1810.04805', reason: '已在库' }])
    // The library lookup from `list` happens first; the write phase adds a ping
    // and its own lookup, then stops without ever calling saveItems.
    assert.deepEqual(connector.calls().slice(1).map(call => call.path), [
      '/connector/ping',
      '/api/users/0/items',
    ])
  } finally {
    await connector.close()
    await plugin.close()
  }
})

test('a page with html keeps a snapshot next to the entry', async () => {
  const connector = await startFakeConnector({ libraryHasDoi: false })
  const store = createStore()
  const zotero = createZotero({ baseUrl: connector.baseUrl })
  const plugin = await startPluginServer({ store, zotero })

  try {
    const html = '<!doctype html><html><head><title>Snapshot Paper</title></head><body><p>Abstract: ' + 'snapshot '.repeat(20) + '</p></body></html>'
    store.upsert('s-html', {
      id: 'url:https://example.test/paper',
      kind: 'page',
      title: 'Snapshot Paper',
      authors: '',
      year: '2024',
      doi: '',
      arxiv: '',
      url: 'https://example.test/paper',
      abstract: 'snapshot '.repeat(20),
      pdfUrl: '',
      pdfPath: '',
      html,
    })

    const saved = await postJson(plugin.url, {
      op: 'save',
      sessionId: 's-html',
      ids: ['url:https://example.test/paper'],
      collectionId: 'C1',
    })
    assert.equal(saved.ok, true)
    assert.deepEqual(connector.calls().map(call => call.path), [
      '/connector/ping',
      '/connector/saveItems',
      '/connector/updateSession',
      '/connector/saveSingleFile',
    ])
    const snapshot = JSON.parse(connector.calls()[3].body)
    assert.equal(snapshot.snapshotContent, html)
    assert.equal(snapshot.url, 'https://example.test/paper')
  } finally {
    await connector.close()
    await plugin.close()
  }
})

test('a pdf the assistant read is proposed, confirmed, and attached from the cached file', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-refs2zotero-e2e-pdf-'))
  const helperPath = join(dir, 'paper.pdf')
  await writeFile(helperPath, pdfBytes)

  const connector = await startFakeConnector({ libraryHasDoi: false })
  const store = createStore()
  const pending = createPending()
  const zotero = createZotero({ baseUrl: connector.baseUrl })
  const proposer = {
    available: true,
    propose: async () => ({
      title: 'A Study Of Widgets',
      creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
      date: '1843',
    }),
  }
  const plugin = await startPluginServer({ store, zotero, proposer })

  try {
    // The assistant used the plugin's own PDF reader; the render carries the
    // cached file, which is what the sidebar and the save path both use.
    onSessionEvent(store, pending, { id: 's-pdf' }, {
      type: 'tool/call',
      data: { callId: 'c1', name: 'read_pdf', arguments: JSON.stringify({ url: 'https://example.test/paper.pdf' }) },
    })
    onSessionEvent(store, pending, { id: 's-pdf' }, {
      type: 'tool/result',
      data: {
        message: {
          role: 'tool',
          toolCallId: 'c1',
          source: { kind: 'tool', callId: 'c1' },
          isError: false,
          content: [{
            type: 'text',
            text: [
              `PDF https://example.test/paper.pdf -> ${helperPath}`,
              '4 pages (read 4)',
              '',
              'A Study Of Widgets',
              'Authors: Ada Lovelace',
              'Abstract: ' + 'widgets '.repeat(30),
            ].join('\n'),
          }],
        },
      },
    })

    const id = 'url:https://example.test/paper.pdf'
    let listed = await postJson(plugin.url, { op: 'list', sessionId: 's-pdf' })
    assert.equal(listed.refs[0].id, id)
    assert.equal(listed.refs[0].kind, 'pdf')
    assert.equal(listed.refs[0].hasPdf, true)
    assert.equal(listed.refs[0].canPropose, true)
    assert.equal(listed.refs[0].proposal, null)

    // The model helps, but the user decides.
    const proposed = await postJson(plugin.url, { op: 'propose', sessionId: 's-pdf', id })
    assert.equal(proposed.ok, true)
    listed = await postJson(plugin.url, { op: 'list', sessionId: 's-pdf' })
    assert.equal(listed.refs[0].title, 'A Study Of Widgets')
    assert.equal(listed.refs[0].proposal.title, 'A Study Of Widgets')
    await postJson(plugin.url, { op: 'confirm', sessionId: 's-pdf', id, accept: true })

    const saved = await postJson(plugin.url, { op: 'save', sessionId: 's-pdf', ids: [id], collectionId: 'C1' })
    assert.deepEqual(saved.saved, [{ id }])
    assert.deepEqual(saved.failed, [])

    const calls = connector.calls()
    assert.deepEqual(calls.slice(1).map(call => call.path), [
      '/connector/saveItems',
      '/connector/updateSession',
      '/connector/saveAttachment',
    ])
    const items = JSON.parse(calls[1].body).items
    assert.equal(items[0].title, 'A Study Of Widgets')
    assert.deepEqual(items[0].creators, [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }])
    assert.equal(items[0].date, '1843')
    // No identifier, so nothing was skipped and no dedupe lookup happened.
    assert.equal(calls.some(call => call.path === '/api/users/0/items'), false)

    const meta = JSON.parse(calls[3].headers['x-metadata'])
    assert.equal(meta.parentItemID, id)
    assert.equal(meta.title, 'A Study Of Widgets')
    assert.deepEqual(Buffer.from(calls[3].body, 'binary'), pdfBytes)
  } finally {
    await connector.close()
    await plugin.close()
  }
})

/** Feed a real `web_fetch` pair, shaped exactly as the harness appends it. */
function deliverFetchedPage(store, pending) {
  const text = [
    '[https://doi.org/10.48550/arXiv.1810.04805](https://doi.org/10.48550/arXiv.1810.04805)',
    '# Title:BERT: Pre-training of Deep Bidirectional Transformers',
    '> Abstract:' + ' bidirectional '.repeat(20),
  ].join('\n')
  onSessionEvent(store, pending, { id: 's-e2e' }, {
    type: 'tool/call',
    data: { turn: 1, step: 1, callId: 'call_1', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://arxiv.org/abs/1810.04805' }) },
  })
  onSessionEvent(store, pending, { id: 's-e2e' }, {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        toolCallId: 'call_1',
        source: { kind: 'tool', callId: 'call_1' },
        isError: false,
        content: [{ type: 'text', text }],
      },
    },
  })
}

/** Feed a `read` of a local .pdf that merges into the fetched page row. */
function deliverReadPdf(store, pending, pdfPath) {
  onSessionEvent(store, pending, { id: 's-e2e' }, {
    type: 'tool/call',
    data: { turn: 1, step: 2, callId: 'call_2', name: 'read', arguments: JSON.stringify({ file_path: pdfPath }) },
  })
  onSessionEvent(store, pending, { id: 's-e2e' }, {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 2,
      message: {
        role: 'tool',
        toolCallId: 'call_2',
        source: { kind: 'tool', callId: 'call_2' },
        isError: false,
        content: [{ type: 'text', text: '10.48550/arXiv.1810.04805' }],
      },
    },
  })
}

/** A stand-in for the desktop connector: real HTTP, recorded requests. */
async function startFakeConnector(options) {
  const log = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      log.push({
        method: req.method,
        path: new URL(req.url, 'http://127.0.0.1').pathname,
        query: new URL(req.url, 'http://127.0.0.1').searchParams,
        headers: req.headers,
        body: body.toString('binary'),
      })
      const path = new URL(req.url, 'http://127.0.0.1').pathname
      if (path === '/connector/ping') return send(res, 200, 'Zotero is running')
      if (path === '/api/users/0/items') {
        const items = options.libraryHasDoi ? [{ data: { DOI: '10.48550/arXiv.1810.04805' } }] : []
        return send(res, 200, JSON.stringify(items))
      }
      if (path === '/connector/getSelectedCollection') {
        return send(res, 200, JSON.stringify({ targets: [{ id: 'C1', name: 'Deepseek Research', level: 1 }] }))
      }
      if (path === '/connector/saveItems') return send(res, 201, '{}')
      if (path === '/connector/updateSession') return send(res, 200, '{}')
      if (path === '/connector/saveAttachment') return send(res, 201, '{}')
      if (path === '/connector/saveSingleFile') return send(res, 201, '{}')
      send(res, 404, 'not found')
    })
  })
  await listen(server)
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls: () => log,
    close: () => close(server),
  }
}

/** The plugin's own route, served through the host handler it registers. */
async function startPluginServer(deps) {
  const server = createServer((req, res) => {
    void handleHttp(req, res, deps)
  })
  await listen(server)
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/dsh-refs2zotero/api`,
    close: () => close(server),
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}
