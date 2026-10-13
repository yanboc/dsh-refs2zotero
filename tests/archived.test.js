import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createArchivedStore } from '../src/archived.js'

test('archive, isArchived, and unarchive round-trip per session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-refs2zotero-archived-'))
  try {
    const store = createArchivedStore({ dir })
    assert.equal(store.isArchived('s1', 'doi:10.1/a'), false)
    store.archive('s1', 'doi:10.1/a')
    assert.equal(store.isArchived('s1', 'doi:10.1/a'), true)
    assert.equal(store.isArchived('s2', 'doi:10.1/a'), false, 'other sessions unaffected')
    store.unarchive('s1', 'doi:10.1/a')
    assert.equal(store.isArchived('s1', 'doi:10.1/a'), false)

    // A fresh instance (a plugin reload) still knows.
    assert.equal(createArchivedStore({ dir }).isArchived('s1', 'doi:10.1/a'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable archive file means nothing is archived', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-refs2zotero-archived-'))
  try {
    await writeFile(join(dir, `archived-${encodeURIComponent('s1')}.json`), 'not json')
    const store = createArchivedStore({ dir })
    assert.equal(store.isArchived('s1', 'x'), false)
    store.archive('s1', 'x')
    assert.equal(store.isArchived('s1', 'x'), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
