import assert from 'node:assert/strict'
import test from 'node:test'
import { collectionStorageKey, initialState, reduce, viewModel } from '../src/view.js'

const papers = [
  { id: 'a', title: 'Attention', authors: 'Vaswani', doi: '10.1000/a', url: 'https://example.test/a', year: '2017', hasPdf: true, inLibrary: false },
  { id: 'b', title: 'BERT', authors: 'Devlin', doi: '10.1000/b', url: 'https://example.test/b', year: '2018', hasPdf: false, inLibrary: true },
]

test('search, select all, and preview', () => {
  let state = { ...initialState(), refs: papers }
  state = reduce(state, { type: 'query', query: 'bert' })
  let model = viewModel(state)
  assert.deepEqual(model.rows.map(row => row.id), ['b'])
  state = reduce(state, { type: 'selectAll' })
  assert.deepEqual(state.selected, ['b'])
  state = reduce(state, { type: 'query', query: '' })
  state = reduce(state, { type: 'selectAll' })
  assert.deepEqual(state.selected, ['b', 'a'])
  model = viewModel(state)
  assert.equal(model.allSelected, true)
  assert.equal(model.canSave, false)
  state = reduce(state, { type: 'collection', id: 'C23' })
  assert.equal(viewModel(state).canSave, true)
  state = reduce(state, { type: 'preview', id: 'a' })
  assert.equal(viewModel(state).preview.title, 'Attention')
  state = reduce(state, { type: 'preview', id: 'a' })
  assert.equal(viewModel(state).preview, null)
})

test('sync drops selections that left the session', () => {
  let state = reduce({ ...initialState(), refs: papers, selected: ['a', 'b'], previewId: 'b' }, {
    type: 'sync',
    refs: [papers[0]],
    collections: [{ id: 'C23', name: '课题', level: 1 }],
    error: '',
  })
  assert.deepEqual(state.selected, ['a'])
  assert.equal(state.previewId, null)
  assert.equal(state.collections[0].name, '课题')
})

test('collection memory key is per session', () => {
  assert.equal(collectionStorageKey('abc'), 'dsh-refs2zotero:abc')
})

test('the write button explains why it is disabled', () => {
  const base = initialState()
  const refs = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  const withRows = { ...base, refs, collections: [{ id: 'C1', name: '库', level: 0 }] }

  assert.equal(viewModel(withRows).saveHint, '先勾选要写入的文献')
  assert.equal(viewModel({ ...withRows, selected: ['a'] }).saveHint, '再选一个已有的分类')
  assert.equal(viewModel({ ...withRows, selected: ['a'], collectionId: 'C1' }).saveHint, '')
  assert.equal(viewModel({ ...withRows, selected: ['a'], collectionId: 'C1' }).canSave, true)
  assert.equal(viewModel({ ...base, selected: ['a'] }).saveHint, '读不到 Zotero 分类；确认桌面端 Zotero 开着')
  assert.equal(viewModel({ ...withRows, selected: ['a'], collectionId: 'C1', saving: true }).saveHint, '正在写入…')
})

test('a failed poll keeps the list and the collection choices', () => {
  const refs = [{ id: 'a', title: 'A' }]
  const collections = [{ id: 'C1', name: '库', level: 0 }]
  const before = reduce(initialState(), { type: 'sync', refs, collections })
  const after = reduce(before, { type: 'sync', error: 'Zotero 没有在运行' })
  assert.deepEqual(after.refs, refs)
  assert.deepEqual(after.collections, collections)
  assert.equal(after.notice, 'Zotero 没有在运行')
})
