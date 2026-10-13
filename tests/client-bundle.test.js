import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the browser bundle registers the sidebar page and does not call zotero', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(client, /dsh-refs2zotero:library/)
  assert.match(client, /参考文献/)
  assert.match(client, /betterSidebar/)
  assert.doesNotMatch(client, /23119/)
  assert.match(host, /\/dsh-refs2zotero\/api/)
  assert.match(host, /ctx\.effect/)
  assert.doesNotMatch(readFileSync(new URL('../src/zotero.js', import.meta.url), 'utf8'), /note:/)
})

test('the pdf reader belongs to the host half only', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  // The browser polls this plugin's route; it must never pull pdf.js or the tool.
  assert.doesNotMatch(client, /pdfjs/)
  assert.doesNotMatch(client, /read_pdf/)
  assert.doesNotMatch(client, /%PDF-/)
  assert.match(host, /read_pdf/)
  assert.match(host, /loadPdfSource/)
})
