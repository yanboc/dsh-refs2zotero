import assert from 'node:assert/strict'
import test from 'node:test'
import { collectRef, extractDoi } from '../src/collect.js'

test('doi extraction strips trailing punctuation', () => {
  assert.equal(extractDoi('see 10.1000/xyz123).'), '10.1000/xyz123')
})

test('a navigation heading does not become the title', () => {
  const text = [
    '                                                                                Developing and evaluating a brief, socially primed video intervention to enable bystander cardiopulmonary resuscitation: A randomised control trial | PLOS One',
    '',
    '[Skip to main content](#main-content)',
    '',
    'Advertisement',
    '',
    '# [PLOS One](/plosone/.)',
    '',
    '-   Publish',
    '',
    '# Developing and evaluating a brief, socially primed video intervention to enable bystander cardiopulmonary resuscitation: A randomised control trial',
    '',
    '## Abstract',
    '',
    '### Background',
    '',
    'Over 30,000 people experience out-of-hospital cardiac arrest in the United Kingdom annually, with only 7-8% of patients surviving.',
    '',
    '### Methods',
    '',
    'In a randomised control trial, participants were assigned to view an ultra-brief CPR video intervention.',
  ].join('\n')
  const ref = collectRef('web_fetch', { url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0297598' }, text)
  assert.equal(ref?.title, 'Developing and evaluating a brief, socially primed video intervention to enable bystander cardiopulmonary resuscitation: A randomised control trial')
  assert.match(ref?.abstract ?? '', /^Over 30,000 people/)
})

test('a doi taken from a url drops the query string', () => {
  assert.equal(
    extractDoi('Fetched https://api.openalex.org/works/doi:10.1371/journal.pone.0297598?select=doi,title (HTTP 200)'),
    '10.1371/journal.pone.0297598',
  )
  assert.equal(extractDoi('https://example.test/10.1000/xyz#section'), '10.1000/xyz')
})

test('doi extraction stops at markdown link syntax', () => {
  // The live fetch of an arXiv page returns the DOI exactly in this shape.
  assert.equal(
    extractDoi('[https://doi.org/10.48550/arXiv.1810.04805](https://doi.org/10.48550/arXiv.1810.04805)'),
    '10.48550/arXiv.1810.04805',
  )
  assert.equal(extractDoi('| DOI | [10.1371/journal.pone.0297598](https://doi.org/10.1371/journal.pone.0297598) |'), '10.1371/journal.pone.0297598')
})

test('an arxiv markdown page keeps its real title', () => {
  const text = [
    ' \\[1810.04805\\] BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    '',
    'Skip to main content',
    '# Computer Science > Computation and Language',
    '**arXiv:1810.04805** (cs)',
    '# Title:BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    '[Jacob Devlin](https://arxiv.org/search/cs?searchtype=author&query=Devlin,+J)',
    '> Abstract:We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.',
    '[https://doi.org/10.48550/arXiv.1810.04805](https://doi.org/10.48550/arXiv.1810.04805)',
  ].join('\n')
  const ref = collectRef('web_fetch', { url: 'https://arxiv.org/abs/1810.04805' }, text)
  assert.equal(ref?.doi, '10.48550/arXiv.1810.04805')
  assert.equal(ref?.title, 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding')
  assert.equal(ref?.id, 'doi:10.48550/arxiv.1810.04805')
})

test('web_fetch of an abstract page is kept', () => {
  const ref = collectRef('web_fetch', { url: 'https://publisher.example/paper' }, [
    '<title>Attention Is All You Need</title>',
    'Authors: Vaswani et al.',
    'Abstract: We propose a new network architecture based on attention mechanisms only, dispensing with recurrence.',
    'DOI: 10.5555/3295222',
  ].join('\n'))
  assert.equal(ref?.kind, 'page')
  assert.equal(ref?.doi, '10.5555/3295222')
  assert.equal(ref?.title, 'Attention Is All You Need')
  assert.equal(ref?.authors, 'Vaswani et al.')
  assert.equal(ref?.pdfUrl, '')
  assert.equal(ref?.html, '')
})

test('web_fetch of html keeps a snapshot', () => {
  const html = '<!doctype html><html><title>Paper</title><body>Abstract: ' + 'word '.repeat(30) + '</body></html>'
  const ref = collectRef('web_fetch', { url: 'https://publisher.example/abs' }, html)
  assert.equal(ref?.html, html)
  assert.equal(ref?.kind, 'page')
})

test('web_fetch of a pdf url is a pdf row', () => {
  const ref = collectRef('web_fetch', { url: 'https://publisher.example/files/paper.pdf' }, '10.1000/pdf-paper')
  assert.equal(ref?.kind, 'pdf')
  assert.equal(ref?.pdfUrl, 'https://publisher.example/files/paper.pdf')
})

test('arxiv abstract page points at the open pdf', () => {
  const ref = collectRef('web_fetch', { url: 'https://arxiv.org/abs/1706.03762' }, 'Abstract: ' + 'attention '.repeat(20))
  assert.equal(ref?.arxiv, '1706.03762')
  assert.equal(ref?.pdfUrl, 'https://arxiv.org/pdf/1706.03762.pdf')
  assert.equal(ref?.kind, 'pdf')
  assert.equal(ref?.year, '2017')
})

test('a pdf read through the plugin tool becomes a pdf row with its cached file', () => {
  const text = [
    'PDF https://arxiv.org/pdf/1810.04805.pdf -> /tmp/dsh-refs2zotero/abc123.pdf',
    '16 pages (read 16)',
    '',
    'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    'Authors: Jacob Devlin, Ming-Wei Chang',
    'Abstract We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations.',
    'https://doi.org/10.48550/arXiv.1810.04805',
  ].join('\n')
  const ref = collectRef('read_pdf', { url: 'https://arxiv.org/pdf/1810.04805.pdf' }, text)
  assert.equal(ref?.kind, 'pdf')
  assert.equal(ref?.pdfPath, '/tmp/dsh-refs2zotero/abc123.pdf')
  assert.equal(ref?.pdfUrl, 'https://arxiv.org/pdf/1810.04805.pdf')
  assert.equal(ref?.doi, '10.48550/arXiv.1810.04805')
  assert.equal(ref?.arxiv, '1810.04805')
  assert.equal(ref?.excerpt?.includes('BERT'), true)
})

test('a pdf read from disk is collected even without an identifier', () => {
  const text = ['PDF /papers/local.pdf -> /papers/local.pdf', '3 pages (read 3)', '', 'Some Paper Title', 'Authors: Ada Lovelace'].join('\n')
  const ref = collectRef('read_pdf', { path: '/papers/local.pdf' }, text)
  assert.equal(ref?.kind, 'pdf')
  assert.equal(ref?.pdfPath, '/papers/local.pdf')
  assert.equal(ref?.id, 'path:/papers/local.pdf')
  assert.equal(ref?.title, 'Some Paper Title')
})

test('reading a scholarly text file counts, an ordinary one does not', () => {
  const scholarly = collectRef('read', { file_path: '/notes/paper.md' }, [
    'Title: A Study Of Things',
    'Authors: Ada Lovelace',
    'Journal: Journal of Things',
    'Abstract: ' + 'body '.repeat(20),
  ].join('\n'))
  assert.equal(scholarly?.title, 'A Study Of Things')
  assert.equal(scholarly?.kind, 'page')

  assert.equal(collectRef('read', { file_path: '/notes/todo.md' }, '# TODO\n- buy milk\n- Volume up the music'), null)
  assert.equal(collectRef('read', { file_path: '/notes/todo.md' }, 'just some notes about nothing at all'), null)
})

test('a read result is parsed as the file, never as its envelope', () => {
  const lines = ['Title: A Real Record', 'Authors: Ada Lovelace', 'Journal: Journal of Things', 'Abstract: ' + 'body '.repeat(12)]
  const envelope = [
    '<path>/notes/paper.md</path>',
    '<type>file</type>',
    '<content>',
    ...lines.map((line, index) => `${index + 1}: ${line}`),
    '',
    '(End of file - total 4 lines)',
    '</content>',
  ].join('\n')
  const ref = collectRef('read', { file_path: '/notes/paper.md' }, envelope)
  assert.equal(ref?.title, 'A Real Record')
  assert.equal(ref?.authors, 'Ada Lovelace')
  assert.equal(ref?.id, 'path:/notes/paper.md')
})

test('a bibtex entry is read as a record', () => {
  const bib = [
    '@article{vaswani2017,',
    '  title = {Attention Is All You Need},',
    '  author = {Vaswani, Ashish},',
    '  doi = {10.48550/arXiv.1706.03762},',
    '  year = {2017}',
    '}',
  ].join('\n')
  const ref = collectRef('read', { file_path: '/refs/attention.bib' }, bib)
  assert.equal(ref?.doi, '10.48550/arXiv.1706.03762')
  assert.equal(ref?.title, 'Attention Is All You Need')
  assert.equal(ref?.year, '2017')
})

test('a file that only mentions a record is not one', () => {
  const source = [
    "import assert from 'node:assert/strict'",
    '// fixtures used by the tests below',
    ...Array.from({ length: 60 }, (_, i) => `const line${i} = ${i}`),
    "const record = 'Title: Deep In The File\\nAuthors: Nobody\\nDOI: 10.1000/deep'",
    "const url = 'https://arxiv.org/abs/1706.03762'",
  ].join('\n')
  assert.equal(collectRef('read', { file_path: '/src/notes.js' }, source), null)
})

test('a read envelope never becomes a title', () => {
  const store = { }
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`)
  const envelope = ['<path>/docs/notes.md</path>', '<type>file</type>', '<content>', ...lines.map((line, i) => `${i + 1}: ${line}`), '</content>'].join('\n')
  assert.equal(collectRef('read', { file_path: '/docs/notes.md' }, envelope), null)
})

test('ordinary pages and failed shapes are ignored', () => {
  assert.equal(collectRef('web_fetch', { url: 'https://example.com' }, 'hello'), null)
  assert.equal(collectRef('web_fetch', {}, 'Abstract: ' + 'word '.repeat(20)), null)
  assert.equal(collectRef('bash', { url: 'https://example.com/a.pdf' }, '10.1000/x'), null)
  assert.equal(collectRef('read', { file_path: 'notes.txt' }, 'Abstract: ' + 'word '.repeat(20)), null)
})

test('read of a pdf path records the file', () => {
  const ref = collectRef('read', { file_path: '/papers/attention.pdf' }, 'Title line of the paper\n10.1000/local')
  assert.equal(ref?.kind, 'pdf')
  assert.equal(ref?.pdfPath, '/papers/attention.pdf')
  assert.equal(ref?.doi, '10.1000/local')
  assert.equal(ref?.id, 'doi:10.1000/local')
})

test('a bare identifier is not mistaken for a pdf title', () => {
  const ref = collectRef('read', { file_path: '/papers/attention.pdf' }, '10.48550/arXiv.1810.04805')
  assert.equal(ref?.doi, '10.48550/arXiv.1810.04805')
  assert.equal(ref?.title, 'attention.pdf')
})
