import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import test from 'node:test'
import { handleApiRequest, handleHttp } from '../src/api.js'
import { createStore } from '../src/store.js'

const ref = {
  id: 'doi:10.1000/a',
  kind: 'page',
  title: 'A Paper',
  authors: 'Ada',
  year: '2020',
  doi: '10.1000/a',
  arxiv: '',
  url: 'https://example.test/a',
  abstract: 'hello abstract',
  pdfUrl: '',
  pdfPath: '',
  html: '<html></html>',
}

test('list marks library hits and hides html', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  const result = await handleApiRequest({ op: 'list', sessionId: 's1' }, {
    store,
    zotero: { findByDoi: async () => true, collections: async () => [], save: async () => ({}) },
  })
  assert.equal(result.ok, true)
  assert.equal(result.refs[0].inLibrary, true)
  assert.equal(result.refs[0].hasHtml, true)
  assert.equal(result.refs[0].html, undefined)
})

test('save rejects a missing collection and forwards the chosen rows', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  const missing = await handleApiRequest({ op: 'save', sessionId: 's1', ids: [ref.id] }, {
    store,
    zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
  })
  assert.equal(missing.ok, false)
  let savedCollection = ''
  const ok = await handleApiRequest({ op: 'save', sessionId: 's1', ids: [ref.id], collectionId: 'C23' }, {
    store,
    zotero: {
      findByDoi: async () => false,
      collections: async () => [],
      save: async (refs, collectionId) => {
        savedCollection = collectionId
        assert.equal(refs[0].html, '<html></html>')
        return { saved: [{ id: ref.id }], skipped: [], failed: [] }
      },
    },
  })
  assert.equal(ok.ok, true)
  assert.equal(savedCollection, 'C23')
})

test('list shows the canonical record over the harvested fields', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  store.resolve('s1', ref.id, {
    title: 'A canonical title',
    creators: [{ creatorType: 'author', firstName: 'Jean', lastName: 'Skelton' }],
    date: '2024-07-05',
    abstractNote: 'The canonical abstract.',
    publicationTitle: 'PLOS One',
    volume: '19',
    issue: '7',
    pages: 'e0297598',
  })
  const result = await handleApiRequest({ op: 'list', sessionId: 's1' }, {
    store,
    zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
  })
  const row = result.refs[0]
  assert.equal(row.title, 'A canonical title')
  assert.equal(row.authors, 'Jean Skelton')
  assert.equal(row.year, '2024')
  assert.equal(row.abstract, 'The canonical abstract.')
  assert.equal(row.publicationTitle, 'PLOS One')
  assert.equal(row.volume, '19')
  assert.equal(row.issue, '7')
  assert.equal(row.pages, 'e0297598')
  assert.equal(row.resolved, true)
})

test('a model proposal is stored, shown, and only used after the user confirms', async () => {
  const store = createStore()
  store.upsert('s1', { ...ref, excerpt: 'x'.repeat(200), doi: '', id: 'path:/tmp/paper.pdf', pdfPath: '/tmp/paper.pdf' })
  const proposer = {
    available: true,
    propose: async () => ({ title: 'Model Title', creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }], date: '1843' }),
  }
  const deps = { store, zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) }, proposer }

  const proposed = await handleApiRequest({ op: 'propose', sessionId: 's1', id: 'path:/tmp/paper.pdf' }, deps)
  assert.equal(proposed.ok, true)
  assert.equal(proposed.proposed.title, 'Model Title')

  // The suggestion is visible, but the entry still uses the harvested fields.
  let listed = await handleApiRequest({ op: 'list', sessionId: 's1' }, deps)
  assert.deepEqual(listed.refs[0].proposal, { title: 'Model Title', authors: 'Ada Lovelace', year: '1843', publicationTitle: '', doi: '', arxiv: '', url: '', itemType: '' })
  assert.equal(listed.refs[0].title, ref.title)

  const accepted = await handleApiRequest({ op: 'confirm', sessionId: 's1', id: 'path:/tmp/paper.pdf', accept: true }, deps)
  assert.equal(accepted.ok, true)
  listed = await handleApiRequest({ op: 'list', sessionId: 's1' }, deps)
  assert.equal(listed.refs[0].title, 'Model Title')
  assert.equal(listed.refs[0].authors, 'Ada Lovelace')
  assert.equal(listed.refs[0].year, '1843')
  assert.equal(listed.refs[0].proposal, null)
})

test('a rejected proposal is dropped', async () => {
  const store = createStore()
  store.upsert('s1', { ...ref, id: 'path:/tmp/p.pdf', doi: '', excerpt: 'x'.repeat(200) })
  const deps = {
    store,
    zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
    proposer: { available: true, propose: async () => ({ title: 'Model Title' }) },
  }
  await handleApiRequest({ op: 'propose', sessionId: 's1', id: 'path:/tmp/p.pdf' }, deps)
  await handleApiRequest({ op: 'confirm', sessionId: 's1', id: 'path:/tmp/p.pdf', accept: false }, deps)
  const listed = await handleApiRequest({ op: 'list', sessionId: 's1' }, deps)
  assert.equal(listed.refs[0].proposal, null)
  assert.equal(listed.refs[0].title, ref.title)
})

test('propose reports a missing model service instead of failing silently', async () => {
  const store = createStore()
  store.upsert('s1', { ...ref, excerpt: 'x'.repeat(200) })
  const result = await handleApiRequest({ op: 'propose', sessionId: 's1', id: ref.id }, {
    store,
    zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /模型服务/)
})

test('http handler only accepts post json', async () => {
  const store = createStore()
  const zotero = { findByDoi: async () => false, collections: async () => [{ id: 'L1', name: '库', level: 0 }], save: async () => ({}) }
  const get = await request('GET', '')
  assert.equal(get.status, 405)
  const bad = await request('POST', '{')
  assert.equal(bad.status, 400)
  const cols = await request('POST', JSON.stringify({ op: 'collections' }))
  assert.equal(cols.status, 200)
  assert.equal(cols.json.collections[0].id, 'L1')

  function request(method, raw) {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void handleHttp(req, res, { store, zotero })
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('no port'))
          return
        }
        const req = fetch(`http://127.0.0.1:${address.port}/dsh-refs2zotero/api`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : raw,
        })
        req.then(async response => {
          const json = await response.json()
          server.close(() => resolve({ status: response.status, json }))
        }).catch(reject)
      })
    })
  }
})

test('archive and unarchive flip the archived flag and persist', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  const state = { archived: new Set() }
  const archived = {
    archive: (sessionId, id) => state.archived.add(`${sessionId}:${id}`),
    unarchive: (sessionId, id) => state.archived.delete(`${sessionId}:${id}`),
    isArchived: (sessionId, id) => state.archived.has(`${sessionId}:${id}`),
  }
  const deps = { store, archived, zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) } }

  const on = await handleApiRequest({ op: 'archive', sessionId: 's1', id: ref.id }, deps)
  assert.equal(on.ok, true)
  assert.equal(on.archived, true)
  // The row stays; only the flag changes.
  assert.equal(store.list('s1').length, 1)
  let listed = await handleApiRequest({ op: 'list', sessionId: 's1' }, deps)
  assert.equal(listed.refs[0].archived, true)

  const off = await handleApiRequest({ op: 'unarchive', sessionId: 's1', id: ref.id }, deps)
  assert.equal(off.ok, true)
  listed = await handleApiRequest({ op: 'list', sessionId: 's1' }, deps)
  assert.equal(listed.refs[0].archived, false)
  assert.equal((await handleApiRequest({ op: 'archive', sessionId: 's1' }, { store })).ok, false)
})

test('fetchPdf downloads a found pdf and attaches it to the row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zotero-refs-fetch-'))
  try {
    const store = createStore()
    store.upsert('s1', { ...ref, id: 'arxiv:1706.03762', doi: '', arxiv: '1706.03762', url: 'https://arxiv.org/abs/1706.03762', pdfUrl: '', pdfPath: '' })
    const pdf = Buffer.from('%PDF-1.4 fetched')
    const result = await handleApiRequest({ op: 'fetchPdf', sessionId: 's1', ids: ['arxiv:1706.03762'] }, {
      store,
      pdfDir: dir,
      fetch: async url => {
        assert.equal(String(url), 'https://arxiv.org/pdf/1706.03762.pdf')
        return { ok: true, arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) }
      },
      zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
    })
    assert.equal(result.ok, true)
    assert.equal(result.results[0].ok, true)
    assert.equal(result.results[0].bytes, pdf.byteLength)
    const row = store.list('s1')[0]
    assert.match(row.pdfPath, /zotero-refs-fetch-.*\.pdf$/)
    assert.equal(row.pdfUrl, 'https://arxiv.org/pdf/1706.03762.pdf')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fetchPdf falls back to an open-access copy for a plain doi', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zotero-refs-oa-'))
  try {
    const store = createStore()
    store.upsert('s1', { ...ref, id: 'doi:10.1371/journal.pone.0297598', doi: '10.1371/journal.pone.0297598', url: 'https://journals.plos.org/x', pdfUrl: '', pdfPath: '' })
    const pdf = Buffer.from('%PDF-1.7 oa')
    const result = await handleApiRequest({ op: 'fetchPdf', sessionId: 's1', ids: ['doi:10.1371/journal.pone.0297598'] }, {
      store,
      pdfDir: dir,
      fetch: async url => {
        if (String(url).startsWith('https://api.openalex.org/')) {
          return { ok: true, json: async () => ({ best_oa_location: { pdf_url: 'https://cdn.example/paper.pdf' } }) }
        }
        assert.equal(String(url), 'https://cdn.example/paper.pdf')
        return { ok: true, arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) }
      },
      zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
    })
    assert.equal(result.results[0].ok, true)
    assert.equal(store.list('s1')[0].pdfPath.length > 0, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fetchPdf reports a row it cannot help', async () => {
  const store = createStore()
  store.upsert('s1', { ...ref, id: 'doi:10.1000/closed', doi: '10.1000/closed', url: '', pdfUrl: '', pdfPath: '' })
  const result = await handleApiRequest({ op: 'fetchPdf', sessionId: 's1', ids: ['doi:10.1000/closed'] }, {
    store,
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
  })
  assert.equal(result.ok, true)
  assert.equal(result.results[0].ok, false)
  assert.match(result.results[0].error, /没找到可下载的 PDF/)
})

test('resolveConflicts forwards the action and selected rows', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  let called
  const deps = {
    store,
    zotero: {
      findByDoi: async () => false,
      collections: async () => [],
      save: async () => ({}),
      resolveConflicts: async (action, refs, collectionId) => {
        called = { action, refs: refs.map(row => row.id), collectionId }
        return { results: [{ id: ref.id, action, ok: true }] }
      },
    },
  }
  const result = await handleApiRequest({ op: 'resolveConflicts', sessionId: 's1', ids: [ref.id], action: 'overwrite', collectionId: 'C23' }, deps)
  assert.equal(result.ok, true)
  assert.deepEqual(called, { action: 'overwrite', refs: [ref.id], collectionId: 'C23' })
  assert.deepEqual(result.results, [{ id: ref.id, action: 'overwrite', ok: true }])

  const bad = await handleApiRequest({ op: 'resolveConflicts', sessionId: 's1', ids: [ref.id], action: 'explode', collectionId: 'C23' }, deps)
  assert.equal(bad.ok, false)
})

test('refresh re-resolves the canonical record for a row with an identifier', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  const calls = []
  const result = await handleApiRequest({ op: 'refresh', sessionId: 's1', id: ref.id }, {
    store,
    enricher: { resolve: async (sessionId, row) => calls.push(`${sessionId}:${row.id}`) },
    zotero: { findByDoi: async () => false, collections: async () => [], save: async () => ({}) },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [`s1:${ref.id}`])
  // A row without an identifier cannot be re-resolved.
  const bare = { id: 'url:https://x', doi: '', arxiv: '', url: 'https://x', title: 'X' }
  store.upsert('s1', bare)
  const failed = await handleApiRequest({ op: 'refresh', sessionId: 's1', id: 'url:https://x' }, { store, enricher: { resolve: async () => {} } })
  assert.equal(failed.ok, false)
})
