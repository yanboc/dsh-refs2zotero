import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createZotero, discoverPdfUrl, isPublicHttpUrl, toConnectorItem } from '../src/zotero.js'

test('a disabled zotero local api skips dedupe with a warning instead of blocking the write', async () => {
  const seen = []
  const server = await listen((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, raw: Buffer.concat(chunks) })
      // Zotero answers 403 here while its Local API switch is off.
      if (req.url.startsWith('/api/users/0/items')) {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('Local API is not enabled')
        return
      }
      if (req.url === '/connector/ping') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('ok')
        return
      }
      if (req.url === '/connector/saveItems') {
        json(res, 201, {})
        return
      }
      if (req.url === '/connector/updateSession') {
        json(res, 200, {})
        return
      }
      res.writeHead(404)
      res.end()
    })
  })

  const zotero = createZotero({ baseUrl: server.url, fetch: async url => {
    if (String(url).startsWith('https://doi.org/')) {
      return { ok: true, json: async () => ({ title: 'Resolved' }) }
    }
    return fetch(url)
  } })
  const result = await zotero.save([
    { id: 'doi:10.1000/a', kind: 'page', title: 'A', doi: '10.1000/a', url: 'https://example.test/a', authors: '', year: '', abstract: '', pdfUrl: '', pdfPath: '', html: '', arxiv: '' },
  ], 'C1')
  await server.close()

  assert.deepEqual(result.failed, [])
  assert.deepEqual(result.saved.map(item => item.id), ['doi:10.1000/a'])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0].reason, /本地 API/)
  assert.ok(seen.some(call => call.url === '/connector/saveItems'))
})

test('a broken dedupe lookup that is not the local api switch still fails the row', async () => {
  const server = await listen((req, res) => {
    if (req.url.startsWith('/api/users/0/items')) {
      res.writeHead(500)
      res.end('boom')
      return
    }
    if (req.url === '/connector/ping') {
      res.writeHead(200)
      res.end('ok')
      return
    }
    res.writeHead(404)
    res.end()
  })
  const zotero = createZotero({ baseUrl: server.url })
  const result = await zotero.save([
    { id: 'doi:10.1000/a', kind: 'page', title: 'A', doi: '10.1000/a', url: '', authors: '', year: '', abstract: '', pdfUrl: '', pdfPath: '', html: '', arxiv: '' },
  ], 'C1')
  await server.close()
  assert.deepEqual(result.saved, [])
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].reason, /500/)
})

test('a row without a pdf url still gets one when the plugin can find it', () => {
  assert.equal(discoverPdfUrl({ arxiv: '1810.04805' }), 'https://arxiv.org/pdf/1810.04805.pdf')
  assert.equal(discoverPdfUrl({ doi: '10.48550/arXiv.1810.04805' }), 'https://arxiv.org/pdf/1810.04805.pdf')
  assert.equal(
    discoverPdfUrl({ url: 'https://publisher.example/article', html: '<a href="/files/paper.pdf">PDF</a>' }),
    'https://publisher.example/files/paper.pdf',
  )
  assert.equal(
    discoverPdfUrl({ url: 'https://publisher.example/article', html: '<meta name="citation_pdf_url" content="https://cdn.example/x.pdf">' }),
    'https://cdn.example/x.pdf',
  )
  assert.equal(discoverPdfUrl({ url: 'https://publisher.example/article', excerpt: 'no link here' }), '')
  assert.equal(discoverPdfUrl({}), '')
  assert.equal(discoverPdfUrl({ doi: '10.1000/not-arxiv' }), '')
})

test('loopback urls are not pdf download targets', () => {
  assert.equal(isPublicHttpUrl('http://127.0.0.1/paper.pdf'), false)
  assert.equal(isPublicHttpUrl('https://arxiv.org/pdf/1706.03762.pdf'), true)
  assert.equal(isPublicHttpUrl('file:///tmp/a.pdf'), false)
})

test('connector item omits a note and keeps collected authors when csl has none', () => {
  const item = toConnectorItem(
    { id: 'doi:10.1000/a', kind: 'page', title: 'Collected', authors: 'Ada Lovelace', year: '2020', doi: '10.1000/a', url: 'https://example.test/a', abstract: 'abs' },
    {},
  )
  assert.equal(item.note, undefined)
  assert.equal(item.creators[0].lastName, 'Ada Lovelace')
  assert.equal(item.date, '2020')
})

test('save writes items, moves them into the collection, and attaches a pdf', async () => {
  const seen = []
  const server = await listen((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      seen.push({ method: req.method, url: req.url, headers: req.headers, raw })
      if (req.url.startsWith('/api/users/0/items')) {
        const doi = new URL(req.url, 'http://zotero.local').searchParams.get('q')
        const items = doi === '10.1000/old' ? [{ data: { DOI: '10.1000/old' } }] : []
        json(res, 200, items)
        return
      }
      if (req.url === '/connector/ping') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('ok')
        return
      }
      if (req.url === '/connector/getSelectedCollection') {
        json(res, 200, { targets: [{ id: 'C23', name: '课题', level: 1 }] })
        return
      }
      if (req.url === '/connector/saveItems' || req.url === '/connector/updateSession' || req.url === '/connector/saveSingleFile') {
        json(res, req.url === '/connector/updateSession' ? 200 : 201, {})
        return
      }
      if (req.url === '/connector/saveAttachment') {
        res.writeHead(201)
        res.end()
        return
      }
      res.writeHead(404)
      res.end()
    })
  })

  const pdf = Buffer.from('%PDF-1.4\n')
  const zotero = createZotero({
    baseUrl: server.url,
    fetch: async (url, init) => {
      const href = String(url)
      if (href.startsWith('https://doi.org/')) {
        return {
          ok: true,
          json: async () => ({ type: 'article-journal', title: 'Resolved', DOI: '10.1000/new', author: [{ given: 'Grace', family: 'Hopper' }] }),
        }
      }
      if (href.startsWith('https://arxiv.org/pdf/')) {
        return { ok: true, arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) }
      }
      if (href.startsWith('https://export.arxiv.org/')) {
        return { ok: true, text: async () => '<feed><entry><title>Attention</title><summary>Abstract text.</summary><published>2017-06-12T00:00:00Z</published><name>Vaswani</name></entry></feed>' }
      }
      return fetch(url, init)
    },
    readFile: async () => pdf,
  })

  const result = await zotero.save([
    { id: 'doi:10.1000/old', kind: 'page', title: 'Old', doi: '10.1000/old', url: 'https://example.test/old', authors: '', year: '', abstract: '', pdfUrl: '', pdfPath: '', html: '', arxiv: '' },
    { id: 'doi:10.1000/new', kind: 'pdf', title: 'New', doi: '10.1000/new', url: 'https://example.test/new', authors: '', year: '', abstract: '', pdfUrl: '', pdfPath: '/tmp/new.pdf', html: '<!doctype html><html></html>', arxiv: '' },
    { id: 'arxiv:1706.03762', kind: 'pdf', title: 'Arxiv', doi: '', arxiv: '1706.03762', url: 'https://arxiv.org/abs/1706.03762', authors: '', year: '2017', abstract: '', pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf', pdfPath: '', html: '', },
  ], 'C23')

  await server.close()

  assert.deepEqual(result.skipped, [{ id: 'doi:10.1000/old', reason: '已在库' }])
  assert.deepEqual(result.saved.map(item => item.id), ['doi:10.1000/new', 'arxiv:1706.03762'])
  assert.deepEqual(result.failed, [])

  const saveItems = bodyJson(seen, '/connector/saveItems')
  assert.equal(saveItems.items.length, 2)
  assert.equal(saveItems.items[0].title, 'Resolved')
  assert.equal(saveItems.items[0].note, undefined)
  assert.equal('note' in saveItems, false)

  // Zotero's default `q` search covers title/creator/year only, so a DOI lookup
  // has to ask for the wide mode or it silently misses every stored DOI.
  const dedupe = seen.find(call => call.url.startsWith('/api/users/0/items'))
  assert.match(dedupe.url, /qmode=everything/)

  const update = bodyJson(seen, '/connector/updateSession')
  assert.equal(update.target, 'C23')
  assert.equal(update.sessionID, saveItems.sessionID)
  assert.equal('note' in update, false)

  const attachments = seen.filter(call => call.url === '/connector/saveAttachment')
  assert.equal(attachments.length, 2)
  assert.equal(attachments[0].headers['content-type'], 'application/pdf')
  const meta = JSON.parse(attachments[0].headers['x-metadata'])
  assert.equal(meta.parentItemID, 'doi:10.1000/new')
  assert.equal(attachments[0].raw.subarray(0, 5).toString(), '%PDF-')

  const snap = bodyJson(seen, '/connector/saveSingleFile')
  assert.match(snap.snapshotContent, /<html>/)
  assert.equal(snap.items[0].id, 'doi:10.1000/new')
})

function bodyJson(seen, url) {
  const call = seen.find(entry => entry.url === url)
  assert.ok(call, url)
  return JSON.parse(call.raw.toString('utf8'))
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('no port'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      })
    })
  })
}
