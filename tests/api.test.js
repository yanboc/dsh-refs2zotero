import assert from 'node:assert/strict'
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
