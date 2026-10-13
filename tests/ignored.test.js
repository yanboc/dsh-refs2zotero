import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createIgnoredStore } from '../src/ignored.js'

test('an ignored row is remembered per session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zotero-refs-ignored-'))
  try {
    const store = createIgnoredStore({ dir })
    assert.equal(store.has('s1', 'doi:10.1/a'), false)
    store.add('s1', 'doi:10.1/a')
    assert.equal(store.has('s1', 'doi:10.1/a'), true)
    assert.equal(store.has('s2', 'doi:10.1/a'), false, 'other sessions are unaffected')

    // A fresh instance (what a plugin reload looks like) still knows.
    assert.equal(createIgnoredStore({ dir }).has('s1', 'doi:10.1/a'), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable ignore file means nothing is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zotero-refs-ignored-'))
  try {
    await writeFile(join(dir, `ignored-${encodeURIComponent('s1')}.json`), 'not json')
    const store = createIgnoredStore({ dir })
    assert.equal(store.has('s1', 'x'), false)
    store.add('s1', 'x')
    assert.equal(store.has('s1', 'x'), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
