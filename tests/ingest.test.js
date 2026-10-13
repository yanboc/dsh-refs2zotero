import assert from 'node:assert/strict'
import test from 'node:test'
import { createPending, onSessionEvent, seedSession } from '../src/ingest.js'
import { createStore } from '../src/store.js'

test('tool results become one row per work and errors are ignored', () => {
  const store = createStore()
  const pending = createPending()
  const session = { id: 's1' }
  onSessionEvent(store, pending, session, {
    type: 'tool/call',
    data: { callId: 'c1', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://arxiv.org/abs/1706.03762' }) },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/result',
    data: { message: { callId: 'c1', isError: false, content: [{ type: 'text', text: 'Abstract: ' + 'attention '.repeat(20) }] } },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/call',
    data: { callId: 'c2', name: 'read', arguments: { file_path: '/papers/attention.pdf' } },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/result',
    data: { message: { callId: 'c2', isError: false, content: [{ type: 'text', text: '10.1000/nope' }] } },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/call',
    data: { callId: 'c3', name: 'web_fetch', arguments: '{"url":"https://example.com"}' },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/result',
    data: { message: { callId: 'c3', isError: true, content: [{ type: 'text', text: '10.1000/hidden' }] } },
  })

  const rows = store.list('s1')
  assert.equal(rows.length, 2)
  const arxiv = rows.find(row => row.arxiv === '1706.03762')
  assert.equal(arxiv?.pdfUrl, 'https://arxiv.org/pdf/1706.03762.pdf')
  assert.equal(rows.some(row => row.doi === '10.1000/hidden'), false)
})

test('the harness tool result shape pairs through toolCallId', () => {
  const store = createStore()
  const pending = createPending()
  const session = { id: 's1' }
  // Shape taken from the running harness: `tool/call` carries a JSON string,
  // `tool/result` carries a `toolCallId` message whose `source.callId` repeats it.
  onSessionEvent(store, pending, session, {
    type: 'tool/call',
    data: { turn: 1, step: 1, callId: 'call_a', name: 'web_fetch', arguments: '{"url":"https://arxiv.org/abs/1706.03762"}' },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        toolCallId: 'call_a',
        source: { kind: 'tool', callId: 'call_a' },
        isError: false,
        content: [{ type: 'text', text: 'Title: Attention Is All You Need\n\nAbstract: ' + 'attention '.repeat(20) }],
      },
    },
  })

  const rows = store.list('s1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].arxiv, '1706.03762')
})

test('a source callId without toolCallId still pairs', () => {
  const store = createStore()
  const pending = createPending()
  const session = { id: 's2' }
  onSessionEvent(store, pending, session, {
    type: 'tool/call',
    data: { callId: 'c9', name: 'web_fetch', arguments: { url: 'https://example.test/paper' } },
  })
  onSessionEvent(store, pending, session, {
    type: 'tool/result',
    data: { message: { source: { kind: 'tool', callId: 'c9' }, content: [{ type: 'text', text: 'Abstract: ' + 'body '.repeat(20) }] } },
  })
  assert.equal(store.list('s2').length, 1)
})

test('merging a pdf into a page row keeps the page title and gains the file', () => {
  const store = createStore()
  store.upsert('s', {
    id: 'doi:10.48550/arxiv.1810.04805', kind: 'page', title: 'BERT: Pre-training of Deep Bidirectional Transformers',
    authors: '', year: '2018', doi: '10.48550/arXiv.1810.04805', arxiv: '1810.04805',
    url: 'https://arxiv.org/abs/1810.04805', abstract: 'abstract', pdfUrl: 'https://arxiv.org/pdf/1810.04805.pdf', pdfPath: '', html: '',
  })
  store.upsert('s', {
    id: 'doi:10.48550/arxiv.1810.04805', kind: 'pdf', title: '10.48550/arXiv.1810.04805',
    authors: '', year: '', doi: '10.48550/arXiv.1810.04805', arxiv: '', url: '', abstract: '', pdfUrl: '', pdfPath: '/tmp/1810.04805.pdf', html: '',
  })
  const rows = store.list('s')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'BERT: Pre-training of Deep Bidirectional Transformers')
  assert.equal(rows[0].pdfPath, '/tmp/1810.04805.pdf')
  assert.equal(rows[0].pdfUrl, 'https://arxiv.org/pdf/1810.04805.pdf')
})

test('a session that already read papers is rebuilt from its own log', () => {
  const store = createStore()
  const pending = createPending()
  const session = {
    id: 's-replay',
    snapshotEvents: () => [
      { type: 'session/start', data: {} },
      {
        type: 'tool/call',
        data: { callId: 'c1', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://arxiv.org/abs/1706.03762' }) },
      },
      {
        type: 'tool/result',
        data: {
          message: {
            toolCallId: 'c1',
            source: { kind: 'tool', callId: 'c1' },
            content: [{ type: 'text', text: 'Title: Attention Is All You Need\nAbstract: ' + 'attention '.repeat(20) }],
          },
        },
      },
      { type: 'tool/call', data: { callId: 'c2', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com' }) } },
      { type: 'tool/result', data: { message: { toolCallId: 'c2', source: { callId: 'c2' }, content: [{ type: 'text', text: 'hello' }] } } },
      { type: 'turn/end', data: {} },
    ],
  }

  const restored = seedSession(store, pending, session)
  assert.equal(restored.length, 1)
  const rows = store.list('s-replay')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].arxiv, '1706.03762')

  // Replaying again must not duplicate anything.
  seedSession(store, pending, session)
  assert.equal(store.list('s-replay').length, 1)
})

test('replaying a session without a log is a no-op', () => {
  const store = createStore()
  const pending = createPending()
  assert.deepEqual(seedSession(store, pending, { id: 's-empty' }), [])
  assert.deepEqual(seedSession(store, pending, undefined), [])
})

test('an envelope-shaped title never overwrites a real one', () => {
  const store = createStore()
  store.upsert('s', {
    id: 'arxiv:1706.03762', kind: 'page', title: 'Attention Is All You Need', authors: '', year: '2017',
    doi: '', arxiv: '1706.03762', url: 'https://arxiv.org/abs/1706.03762', abstract: '', pdfUrl: '', pdfPath: '', html: '',
  })
  store.upsert('s', {
    id: 'path:/src/notes.js', kind: 'page', title: '<path>/src/notes.js</path>', authors: '', year: '',
    doi: '', arxiv: '1706.03762', url: '', abstract: '', pdfUrl: '', pdfPath: '', html: '',
  })
  const rows = store.list('s')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Attention Is All You Need')
})

test('the same doi from a page and a pdf collapses to one pdf row', () => {
  const store = createStore()
  store.upsert('s', {
    id: 'doi:10.1000/a', kind: 'page', title: 'https://example.test/a', authors: '', year: '', doi: '10.1000/a', arxiv: '', url: 'https://example.test/a', abstract: '', pdfUrl: '', pdfPath: '', html: '',
  })
  store.upsert('s', {
    id: 'doi:10.1000/a', kind: 'pdf', title: 'Real Title', authors: 'Ada', year: '2020', doi: '10.1000/a', arxiv: '', url: 'https://example.test/a', abstract: 'abs', pdfUrl: '', pdfPath: '/tmp/a.pdf', html: '',
  })
  const rows = store.list('s')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Real Title')
  assert.equal(rows[0].pdfPath, '/tmp/a.pdf')
  assert.equal(rows[0].kind, 'pdf')
})

test('disposing a session drops its rows', () => {
  const store = createStore()
  store.upsert('s', { id: 'url:x', kind: 'page', title: 'T', authors: '', year: '', doi: '', arxiv: '', url: 'https://example.test', abstract: 'a', pdfUrl: '', pdfPath: '', html: '' })
  store.drop('s')
  assert.deepEqual(store.list('s'), [])
})
