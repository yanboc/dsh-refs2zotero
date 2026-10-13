import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPublicHttpUrl } from './zotero.js'

export const MAX_PDF_BYTES = 40 * 1024 * 1024
export const DEFAULT_MAX_PAGES = 30
export const DEFAULT_MAX_CHARS = 40000

/**
 * Read a PDF into text. The harness has no PDF reader of its own — `read`
 * rejects binary and `web_fetch` rejects `application/pdf` — so the plugin
 * brings its own, over Mozilla's pdf.js.
 *
 * `deps.load` is injectable so tests do not need a real pdf.js.
 *
 * @param {Uint8Array} bytes
 * @param {{ maxPages?: number, maxChars?: number, load?: () => Promise<any> }} [options]
 */
export async function extractPdfText(bytes, options = {}) {
  const pdfjs = await (options.load ?? loadPdfJs)()
  const doc = await pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise
  try {
    const total = doc.numPages
    const readPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, total))
    const pages = []
    for (let number = 1; number <= readPages; number += 1) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      const line = content.items
        .map(item => (typeof item?.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (line) pages.push(line)
      page.cleanup?.()
    }
    const text = pages.join('\n\n').slice(0, options.maxChars ?? DEFAULT_MAX_CHARS)
    return { pages: total, readPages, text }
  } finally {
    await doc.destroy?.()
  }
}

/**
 * Fetch a public PDF. Loopback and private hosts are refused, and so is a body
 * that is not actually a PDF.
 * @param {string} url
 * @param {{ fetch?: typeof fetch }} [deps]
 */
export async function downloadPdf(url, deps = {}) {
  if (!isPublicHttpUrl(url)) throw new Error('只下载公开的 http(s) PDF 地址')
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const response = await fetchImpl(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`PDF 下载失败 ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assertPdfBytes(bytes)
  return bytes
}

/**
 * @param {Uint8Array} bytes
 */
export function assertPdfBytes(bytes) {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDF 超过 40MB')
  const head = Buffer.from(bytes.subarray(0, 5)).toString('latin1')
  if (bytes.byteLength < 5 || head !== '%PDF-') throw new Error('下载到的不是 PDF')
}

/**
 * Keep the fetched file on disk, so the same bytes can be handed to Zotero
 * later without downloading them twice.
 * @param {Uint8Array} bytes
 * @param {{ dir?: string }} [deps]
 * @returns {Promise<string>} absolute path
 */
export async function cachePdf(bytes, deps = {}) {
  const dir = deps.dir ?? join(tmpdir(), 'dsh-refs2zotero')
  await mkdir(dir, { recursive: true })
  const name = `${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.pdf`
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

/**
 * Resolve a tool/row PDF source into bytes plus the local path holding them.
 * @param {{ url?: string, path?: string }} source
 * @param {{ fetch?: typeof fetch, readFile?: typeof readFile, dir?: string }} [deps]
 * @returns {Promise<{ bytes: Uint8Array, path: string, url: string }>}
 */
export async function loadPdfSource(source, deps = {}) {
  const read = deps.readFile ?? readFile
  if (source.path) {
    const bytes = new Uint8Array(await read(source.path))
    assertPdfBytes(bytes)
    return { bytes, path: source.path, url: '' }
  }
  if (!source.url) throw new Error('需要 path 或 url')
  const bytes = await downloadPdf(source.url, deps)
  const path = await cachePdf(bytes, deps)
  return { bytes, path, url: source.url }
}

async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs')
}
