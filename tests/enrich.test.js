import assert from 'node:assert/strict'
import test from 'node:test'
import { createEnricher } from '../src/enrich.js'
import { createStore } from '../src/store.js'

const ref = {
  id: 'doi:10.1371/journal.pone.0297598',
  kind: 'page',
  title: '[PLOS One](/plosone/.)',
  authors: '',
  year: '2024',
  doi: '10.1371/journal.pone.0297598',
  arxiv: '',
  url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0297598',
  abstract: '### Background',
  pdfUrl: '',
  pdfPath: '',
  html: '',
}

const csl = {
  type: 'article-journal',
  title: 'Developing and evaluating a brief, socially primed video intervention',
  author: [{ family: 'Skelton', given: 'Jean' }],
  issued: { 'date-parts': [[2024, 7, 5]] },
  'container-title': 'PLOS One',
  volume: '19',
  issue: '7',
  page: 'e0297598',
}

test('a collected doi resolves to the canonical record beside the collected fields', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  const enricher = createEnricher(store, {
    fetch: async url => {
      assert.equal(url, 'https://doi.org/10.1371%2Fjournal.pone.0297598')
      return { ok: true, json: async () => csl }
    },
  })
  await enricher.resolve('s1', ref)

  const row = store.list('s1')[0]
  assert.equal(row.resolved.title, csl.title)
  assert.equal(row.resolved.publicationTitle, 'PLOS One')
  // The collected fields stay as harvested; display picks the canonical record.
  assert.equal(row.title, '[PLOS One](/plosone/.)')
})

test('a failed lookup leaves the collected row untouched', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  const enricher = createEnricher(store, { fetch: async () => { throw new Error('offline') } })
  await enricher.resolve('s1', ref)
  assert.equal(store.list('s1')[0].resolved, undefined)
})

test('a row without an identifier is never looked up', async () => {
  const store = createStore()
  const plain = { ...ref, id: 'url:https://example.test/x', doi: '', arxiv: '' }
  store.upsert('s1', plain)
  let calls = 0
  const enricher = createEnricher(store, { fetch: async () => { calls += 1; return { ok: true, json: async () => csl } } })
  await enricher.resolve('s1', plain)
  assert.equal(calls, 0)
})

test('one identifier is not looked up twice while the first call is in flight', async () => {
  const store = createStore()
  store.upsert('s1', ref)
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const enricher = createEnricher(store, {
    fetch: async () => {
      calls += 1
      await gate
      return { ok: true, json: async () => csl }
    },
  })
  const first = enricher.resolve('s1', ref)
  await enricher.resolve('s1', ref)
  release()
  await first
  assert.equal(calls, 1)
})

test('resolved metadata survives a later duplicate of the same work', () => {
  const store = createStore()
  store.upsert('s1', ref)
  store.resolve('s1', ref.id, { title: csl.title })
  store.upsert('s1', { ...ref, url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0297598&utm_source=x' })
  const rows = store.list('s1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].resolved.title, csl.title)
})
