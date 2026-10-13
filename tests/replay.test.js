import assert from 'node:assert/strict'
import test from 'node:test'
import { createPending } from '../src/ingest.js'
import { createReplay } from '../src/replay.js'
import { createStore } from '../src/store.js'

function sessionWithLog(id, url, title) {
  return {
    id,
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'c1', name: 'web_fetch', arguments: JSON.stringify({ url }) } },
      {
        type: 'tool/result',
        data: {
          message: {
            toolCallId: 'c1',
            source: { kind: 'tool', callId: 'c1' },
            content: [{ type: 'text', text: `Title: ${title}\nAbstract: ${'body '.repeat(20)}` }],
          },
        },
      },
    ],
  }
}

test('every live session is replayed, not only the current one', () => {
  const store = createStore()
  const replay = createReplay({ store, pending: createPending() })
  const restored = replay.all({
    list: () => [
      sessionWithLog('s1', 'https://example.test/one', 'One'),
      sessionWithLog('s2', 'https://example.test/two', 'Two'),
      { id: 's3' },
    ],
  })
  assert.equal(restored.length, 2)
  assert.equal(store.list('s1')[0].title, 'One')
  assert.equal(store.list('s2')[0].title, 'Two')
  assert.deepEqual(store.list('s3'), [])
})

test('a session with no service list is tolerated', () => {
  const store = createStore()
  const replay = createReplay({ store, pending: createPending() })
  assert.deepEqual(replay.all(undefined), [])
  assert.deepEqual(replay.all({}), [])
})

test('replayed rows with an identifier get their canonical record, in order', async () => {
  const store = createStore()
  const seen = []
  const replay = createReplay({
    store,
    pending: createPending(),
    enricher: {
      resolve: async (sessionId, ref) => {
        seen.push(`${sessionId}:${ref.id}`)
        store.resolve(sessionId, ref.id, { title: `canonical ${ref.id}` })
      },
    },
  })
  replay.one(sessionWithLog('s1', 'https://arxiv.org/abs/1706.03762', 'Attention'))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(seen.length, 1)
  assert.match(seen[0], /^s1:arxiv:1706\.03762$/)
  assert.equal(store.list('s1')[0].resolved.title, 'canonical arxiv:1706.03762')
})

test('a session whose log cannot be read is skipped, not fatal', () => {
  const store = createStore()
  const replay = createReplay({ store, pending: createPending() })
  const broken = { id: 's-broken', snapshotEvents: () => { throw new Error('log unavailable') } }
  const restored = replay.all({ list: () => [broken, sessionWithLog('s-ok', 'https://example.test/ok', 'Ok')] })
  assert.equal(restored.length, 1)
  assert.equal(store.list('s-ok')[0].title, 'Ok')
  assert.deepEqual(store.list('s-broken'), [])
  assert.deepEqual(replay.one(broken), [])
})

test('a session service that cannot be listed is not fatal', () => {
  const store = createStore()
  const replay = createReplay({ store, pending: createPending() })
  assert.deepEqual(replay.all({ list: () => { throw new Error('no list') } }), [])
})

test('replaying the same session twice keeps one row', () => {
  const store = createStore()
  const replay = createReplay({ store, pending: createPending() })
  const session = sessionWithLog('s1', 'https://example.test/one', 'One')
  replay.one(session)
  replay.one(session)
  assert.equal(store.list('s1').length, 1)
})

test('an archived row is still restored by a later replay', () => {
  // Archiving hides a row in the UI; it does not erase it, so a reload must
  // bring it back (the archived flag is applied at list time, not replay time).
  const session = sessionWithLog('s1', 'https://arxiv.org/abs/1706.03762', 'Attention')
  const store = createStore()
  createReplay({ store, pending: createPending() }).one(session)
  const reloaded = createStore()
  createReplay({ store: reloaded, pending: createPending() }).one(session)
  assert.equal(reloaded.list('s1').length, 1)
  assert.equal(reloaded.list('s1')[0].arxiv, '1706.03762')
})
