import assert from 'node:assert/strict'
import test from 'node:test'
import { findOpenAccessPdf } from '../src/oa.js'

test('the published copy of the doi wins over a preprint copy', async () => {
  const url = await findOpenAccessPdf('10.1371/journal.pone.0297598', {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        best_oa_location: { pdf_url: 'https://www.medrxiv.org/content/2024.01.10.24301133.full.pdf' },
        locations: [
          { pdf_url: 'https://www.medrxiv.org/content/2024.01.10.24301133.full.pdf' },
          { pdf_url: 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0297598&type=printable' },
        ],
      }),
    }),
  })
  assert.equal(url, 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0297598&type=printable')
})

test('a non-doi, a missing oa copy, and a failure all yield nothing', async () => {
  assert.equal(await findOpenAccessPdf('nonsense', { fetch: async () => ({ ok: true, json: async () => ({}) }) }), '')
  assert.equal(await findOpenAccessPdf('10.1000/closed', { fetch: async () => ({ ok: true, json: async () => ({ locations: [] }) }) }), '')
  assert.equal(await findOpenAccessPdf('10.1000/boom', { fetch: async () => { throw new Error('offline') } }), '')
})
