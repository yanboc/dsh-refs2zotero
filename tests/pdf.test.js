import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertPdfBytes, cachePdf, downloadPdf, extractPdfText, loadPdfSource } from '../src/pdf.js'

test('pdf text is extracted page by page through the injected reader', async () => {
  const seen = {}
  const fake = {
    getDocument: options => {
      seen.data = options.data
      return {
        promise: Promise.resolve({
          numPages: 5,
          getPage: async number => ({
            getTextContent: async () => ({ items: [{ str: 'page' }, { str: String(number) }] }),
            cleanup() {},
          }),
          destroy: async () => { seen.destroyed = true },
        }),
      }
    },
  }
  const bytes = new Uint8Array([1, 2, 3])
  const result = await extractPdfText(bytes, { load: async () => fake, maxPages: 2, maxChars: 100 })
  assert.equal(seen.data, bytes)
  assert.equal(result.pages, 5)
  assert.equal(result.readPages, 2)
  assert.equal(result.text, 'page 1\n\npage 2')
  assert.equal(seen.destroyed, true)
})

test('extraction never reports more pages than the document has', async () => {
  const fake = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'only' }] }), cleanup() {} }),
        destroy: async () => {},
      }),
    }),
  }
  const result = await extractPdfText(new Uint8Array([1]), { load: async () => fake, maxPages: 30 })
  assert.equal(result.readPages, 1)
})

test('only real pdf bytes are accepted', () => {
  assert.doesNotThrow(() => assertPdfBytes(Buffer.from('%PDF-1.7\n...')))
  assert.throws(() => assertPdfBytes(Buffer.from('<html></html>')), /不是 PDF/)
  assert.throws(() => assertPdfBytes(Buffer.from('%PD')), /不是 PDF/)
})

test('downloads refuse loopback and non-pdf bodies', async () => {
  await assert.rejects(() => downloadPdf('http://127.0.0.1:23119/a.pdf'), /公开/)
  await assert.rejects(() => downloadPdf('file:///tmp/a.pdf'), /公开/)
  const bytes = Buffer.from('%PDF-1.4 fake')
  await assert.rejects(
    () => downloadPdf('https://example.test/a.pdf', { fetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('nope').buffer }) }),
    /不是 PDF/,
  )
  await assert.rejects(
    () => downloadPdf('https://example.test/a.pdf', { fetch: async () => ({ ok: false, status: 404 }) }),
    /404/,
  )
  const ok = await downloadPdf('https://example.test/a.pdf', {
    fetch: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
  })
  assert.equal(Buffer.from(ok).toString('latin1'), '%PDF-1.4 fake')
})

test('a downloaded pdf is cached to a local file and reused from there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-refs2zotero-pdf-'))
  try {
    const bytes = Buffer.from('%PDF-1.4 cached')
    const path = await cachePdf(new Uint8Array(bytes), { dir })
    assert.equal(Buffer.from(await readFile(path)).toString('latin1'), '%PDF-1.4 cached')

    const loaded = await loadPdfSource({ url: 'https://example.test/x.pdf' }, {
      dir,
      fetch: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
    })
    assert.equal(loaded.url, 'https://example.test/x.pdf')
    assert.equal(Buffer.from(await readFile(loaded.path)).toString('latin1'), '%PDF-1.4 cached')

    const fromDisk = await loadPdfSource({ path }, { dir })
    assert.equal(fromDisk.path, path)
    assert.equal(fromDisk.url, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadPdfSource needs a source and rejects a non-pdf file', async () => {
  await assert.rejects(() => loadPdfSource({}), /需要 path 或 url/)
  await assert.rejects(
    () => loadPdfSource({ path: '/tmp/not-a-pdf.txt' }, { readFile: async () => Buffer.from('hello') }),
    /不是 PDF/,
  )
})
