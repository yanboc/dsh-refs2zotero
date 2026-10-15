import assert from 'node:assert/strict'
import test from 'node:test'
import { collectionStorageKey, initialState, metaBadgeAction, reduce, sortRefs, viewModel, visibleRows } from '../src/view.js'

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

test('the rows being searched for a pdf are tracked', () => {
  const state = reduce(initialState(), { type: 'fetching', ids: ['a'] })
  assert.deepEqual(state.fetching, ['a'])
  assert.deepEqual(reduce(state, { type: 'fetching', ids: [] }).fetching, [])
})

test('rows sort by title, authors, or year, ascending or descending', () => {
  const refs = [
    { id: 'a', title: 'Beta', authors: 'Zeta', year: '2019' },
    { id: 'b', title: 'Alpha', authors: 'Alpha', year: '2021' },
    { id: 'c', title: 'Gamma', authors: 'Beta', year: '' },
  ]
  assert.deepEqual(sortRefs(refs, 'title', true).map(ref => ref.id), ['b', 'a', 'c'])
  assert.deepEqual(sortRefs(refs, 'title', false).map(ref => ref.id), ['c', 'a', 'b'])
  assert.deepEqual(sortRefs(refs, 'authors', true).map(ref => ref.id), ['b', 'c', 'a'])
  // Missing year sorts last ascending, first descending.
  assert.deepEqual(sortRefs(refs, 'year', true).map(ref => ref.id), ['a', 'b', 'c'])
  assert.deepEqual(sortRefs(refs, 'year', false).map(ref => ref.id), ['b', 'a', 'c'])
})

test('archived rows are hidden until the eye is on', () => {
  const refs = [
    { id: 'a', title: 'A', archived: false },
    { id: 'b', title: 'B', archived: true },
  ]
  assert.deepEqual(visibleRows({ ...initialState(), refs }).map(ref => ref.id), ['a'])
  assert.deepEqual(visibleRows({ ...initialState(), refs, showArchived: true }).map(ref => ref.id), ['a', 'b'])
  assert.equal(viewModel({ ...initialState(), refs }).archivedCount, 1)
})

test('setArchived and toggleArchived flip their flags', () => {
  let state = reduce({ ...initialState(), refs: [{ id: 'a', title: 'A', archived: false }] }, { type: 'setArchived', id: 'a', value: true })
  assert.equal(state.refs[0].archived, true)
  state = reduce(state, { type: 'toggleArchived' })
  assert.equal(state.showArchived, true)
})

test('the metadata badge is an action only when there is something to fetch', () => {
  // Resolved rows re-fetch the canonical record.
  assert.equal(metaBadgeAction({ resolved: true }), 'refresh')
  // A DOI or arXiv id is enough to fetch metadata, even with no title or excerpt.
  assert.equal(metaBadgeAction({ doi: '10.1000/a' }), 'refresh')
  assert.equal(metaBadgeAction({ arxiv: '1810.04805' }), 'refresh')
  // With no identifier, an excerpt lets the model propose a record.
  assert.equal(metaBadgeAction({ canPropose: true }), 'propose')
  // A pending proposal wins: the user must adopt or ignore it first.
  assert.equal(metaBadgeAction({ proposal: {} }), null)
  assert.equal(metaBadgeAction({ proposal: {}, doi: '10.1000/a' }), null)
  // Nothing to fetch: a static label.
  assert.equal(metaBadgeAction({}), null)
})

test('conflicts are selected and resolved in batches', () => {
  let state = reduce(initialState(), {
    type: 'conflicts',
    conflicts: [{ id: 'a', key: 'K', existingTitle: 'A' }, { id: 'b', key: 'K2', existingTitle: 'B' }],
  })
  assert.deepEqual(state.conflictSelected, ['a', 'b'])
  state = reduce(state, { type: 'conflictSelect', id: 'a' })
  assert.deepEqual(state.conflictSelected, ['b'])
  state = reduce(state, { type: 'conflictAction', action: 'cancel' })
  assert.equal(state.conflictAction, 'cancel')
  state = reduce(state, { type: 'conflictResolved', ids: ['b'] })
  assert.deepEqual(state.conflicts, [{ id: 'a', key: 'K', existingTitle: 'A' }])
  assert.deepEqual(state.conflictSelected, [])
  state = reduce(state, { type: 'conflictSelectAll' })
  assert.deepEqual(state.conflictSelected, ['a'])
  state = reduce(state, { type: 'conflictSelectAll' })
  assert.deepEqual(state.conflictSelected, [])
})

test('flash increments the part that is missing', () => {
  let state = initialState()
  state = reduce(state, { type: 'flash', collection: true })
  assert.deepEqual(state.flash, { collection: 1, rows: 0 })
  state = reduce(state, { type: 'flash', rows: true })
  assert.deepEqual(state.flash, { collection: 1, rows: 1 })
})
