import assert from 'node:assert/strict'
import test from 'node:test'
import { mapArxivAtom, mapCsl, resolveMetadata } from '../src/metadata.js'

test('csl json maps onto zotero fields and drops blanks', () => {
  const item = mapCsl({
    type: 'article-journal',
    title: 'A Paper',
    author: [{ given: 'Ada', family: 'Lovelace' }, { literal: '' }],
    issued: { 'date-parts': [[2020, 6, 1]] },
    DOI: '10.1000/abc',
    URL: 'https://publisher.example/abc',
    abstract: 'Short abstract.',
    'container-title': 'Journal of Tests',
    volume: '3',
    issue: '1',
    page: '10-12',
  })
  assert.deepEqual(item, {
    itemType: 'journalArticle',
    title: 'A Paper',
    creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
    date: '2020-06-01',
    DOI: '10.1000/abc',
    url: 'https://publisher.example/abc',
    abstractNote: 'Short abstract.',
    publicationTitle: 'Journal of Tests',
    volume: '3',
    issue: '1',
    pages: '10-12',
  })
})

test('missing csl fields are not invented', () => {
  assert.deepEqual(mapCsl({ type: 'article-journal' }), { itemType: 'journalArticle' })
})

test('arxiv atom maps the entry, not the feed title', () => {
  const xml = `<?xml><feed><title>ArXiv Query</title><entry><title>Real Title</title><name>First Author</name><summary>The summary.</summary><published>2017-06-12T00:00:00Z</published></entry></feed>`
  assert.deepEqual(mapArxivAtom(xml), {
    itemType: 'preprint',
    title: 'Real Title',
    abstractNote: 'The summary.',
    date: '2017-06-12',
    creators: [{ creatorType: 'author', firstName: '', lastName: 'First Author' }],
  })
})

test('resolveMetadata uses doi.org and keeps going when the network fails', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('doi.org')) {
      return { ok: true, json: async () => ({ type: 'article-journal', title: 'From DOI', DOI: '10.1000/z' }) }
    }
    throw new Error('down')
  }
  const item = await resolveMetadata({ doi: '10.1000/z', arxiv: '' }, { fetch: fetchImpl })
  assert.equal(item.title, 'From DOI')
  assert.equal(calls.length, 1)
  const empty = await resolveMetadata({ doi: '10.1000/missing' }, {
    fetch: async () => { throw new Error('down') },
  })
  assert.deepEqual(empty, {})
})
