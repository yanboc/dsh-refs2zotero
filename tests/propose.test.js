import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrompt, createProposer, parseRecord } from '../src/propose.js'

test('the prompt carries the harvested hints and the document text', () => {
  const prompt = buildPrompt(
    { title: 'Harvested', url: 'https://example.test/a', doi: '10.1000/a', arxiv: '1810.04805' },
    'Body text of the paper.',
  )
  assert.match(prompt, /Harvested title: Harvested/)
  assert.match(prompt, /Source URL: https:\/\/example\.test\/a/)
  assert.match(prompt, /Harvested DOI: 10\.1000\/a/)
  assert.match(prompt, /Harvested arXiv id: 1810\.04805/)
  assert.match(prompt, /Body text of the paper\./)
})

test('a model answer is parsed even when wrapped in prose and fences', () => {
  const record = parseRecord([
    'Sure, here it is:',
    '```json',
    '{"title":"A Paper","authors":["Skelton, Jean","Templeton, Anne"],"year":"2024","venue":"PLOS ONE","itemType":"journalArticle","doi":"https://doi.org/10.1371/journal.pone.0297598","abstract":"An abstract."}',
    '```',
  ].join('\n'))
  assert.equal(record.title, 'A Paper')
  assert.deepEqual(record.creators, [
    { creatorType: 'author', firstName: 'Jean', lastName: 'Skelton' },
    { creatorType: 'author', firstName: 'Anne', lastName: 'Templeton' },
  ])
  assert.equal(record.date, '2024')
  assert.equal(record.publicationTitle, 'PLOS ONE')
  assert.equal(record.DOI, '10.1371/journal.pone.0297598')
  assert.equal(record.abstractNote, 'An abstract.')
})

test('unusable model output is refused rather than guessed', () => {
  assert.equal(parseRecord('I could not find a title.'), null)
  assert.equal(parseRecord('{}'), null)
  assert.equal(parseRecord(''), null)
  assert.equal(parseRecord(undefined), null)
  const partial = parseRecord('{"title":"Only A Title","year":"not a year","doi":"nonsense","arxiv":"nope"}')
  assert.deepEqual(partial, { title: 'Only A Title' })
})

test('the proposer asks the model and returns a record', async () => {
  const calls = []
  const proposer = createProposer({
    stream: options => {
      calls.push(options)
      return (async function* () {
        yield { type: 'text-delta', text: '{"title":"From The Model",' }
        yield { type: 'text-delta', text: '"authors":["Devlin, Jacob"],"year":"2018"}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })
  assert.equal(proposer.available, true)
  const record = await proposer.propose({ title: 'BERT', excerpt: 'x'.repeat(200) })
  assert.equal(record.title, 'From The Model')
  assert.equal(record.date, '2018')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'deepseek-official')
  assert.deepEqual(calls[0].messages[0].content, [{ type: 'text', text: calls[0].messages[0].content[0].text }])
})

test('a reasoning-only answer is still read', async () => {
  // deepseek-flash streams reasoning-delta and can finish without text-delta.
  const proposer = createProposer({
    stream: () => (async function* () {
      yield { type: 'reasoning-delta', text: 'Let me look. The record is ' }
      yield { type: 'reasoning-delta', text: '{"title":"From Reasoning","year":"2017"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  })
  const record = await proposer.propose({ excerpt: 'x'.repeat(200) })
  assert.equal(record.title, 'From Reasoning')
  assert.equal(record.date, '2017')
})

test('the proposer refuses an excerpt that is too short to judge', async () => {
  const proposer = createProposer({ stream: () => (async function* () {})() })
  await assert.rejects(() => proposer.propose({ excerpt: 'too short' }), /没有足够的正文/)
})

test('an unavailable model service is reported, not silently skipped', async () => {
  const proposer = createProposer({})
  assert.equal(proposer.available, false)
  await assert.rejects(() => proposer.propose({ excerpt: 'x'.repeat(200) }), /没有可用的模型服务/)
})

test('a terminal model error surfaces as a failure', async () => {
  const proposer = createProposer({
    stream: () => (async function* () {
      yield { type: 'finish', reason: { kind: 'error' } }
    })(),
  })
  await assert.rejects(() => proposer.propose({ excerpt: 'x'.repeat(200) }), /模型调用失败/)
})
