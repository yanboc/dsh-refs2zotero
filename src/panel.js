import { collectionStorageKey, initialState, reduce, viewModel } from './view.js'

/**
 * @param {typeof import('react')} React
 */
export function createApply(React) {
  const { createElement: h, useEffect, useReducer } = React

  function Panel({ sessionId, visible }) {
    const [state, dispatch] = useReducer(reduce, undefined, () => {
      const base = initialState()
      try {
        const saved = sessionStorage.getItem(collectionStorageKey(sessionId))
        if (saved) base.collectionId = saved
      } catch {
        // sessionStorage can throw in private browsing.
      }
      return base
    })

    useEffect(() => {
      if (!visible) return undefined
      let stop = false
      async function tick() {
        const listed = await post({ op: 'list', sessionId })
        const cols = await post({ op: 'collections' })
        if (stop) return
        dispatch({
          type: 'sync',
          // Omit what failed so a transient error cannot wipe the list or the
          // collection choices out from under the user.
          ...(listed.ok ? { refs: listed.refs } : {}),
          ...(cols.ok ? { collections: cols.collections } : {}),
          error: !listed.ok ? listed.error : !cols.ok ? cols.error : '',
        })
      }
      void tick()
      const timer = setInterval(() => { void tick() }, 2000)
      return () => {
        stop = true
        clearInterval(timer)
      }
    }, [visible, sessionId])

    useEffect(() => {
      try {
        if (state.collectionId) sessionStorage.setItem(collectionStorageKey(sessionId), state.collectionId)
      } catch {
        // Ignore storage failures.
      }
    }, [sessionId, state.collectionId])

    const model = viewModel(state)

    async function onSave() {
      dispatch({ type: 'saving', value: true })
      dispatch({ type: 'message', text: '' })
      const result = await post({
        op: 'save',
        sessionId,
        ids: state.selected,
        collectionId: state.collectionId,
      })
      dispatch({ type: 'saving', value: false })
      if (!result.ok) {
        dispatch({ type: 'message', text: result.error || '保存失败' })
        return
      }
      const saved = result.saved?.length ?? 0
      const skipped = result.skipped?.length ?? 0
      const failed = result.failed ?? []
      const warnings = result.warnings ?? []
      const parts = [`已写入 ${saved} 条`]
      if (skipped) parts.push(`已在库 ${skipped} 条`)
      if (failed.length) parts.push(failed.map(item => item.reason).join('；'))
      if (warnings.length) parts.push(warnings.map(item => item.reason).join('；'))
      dispatch({ type: 'message', text: parts.join('，') })
    }

    return h('div', { style: pageStyle },
      h('div', { style: toolbarStyle },
        h('input', {
          'aria-label': '搜索',
          placeholder: '搜索题名、作者、DOI',
          value: state.query,
          onChange: (event) => dispatch({ type: 'query', query: event.target.value }),
          style: inputStyle,
        }),
        h('button', { type: 'button', onClick: () => dispatch({ type: 'selectAll' }) }, model.allSelected ? '取消全选' : '全选'),
        h('select', {
          'aria-label': '分类',
          value: state.collectionId,
          onChange: (event) => dispatch({ type: 'collection', id: event.target.value }),
        },
          h('option', { value: '' }, '选择已有分类'),
          ...state.collections.map(collection => h('option', { key: collection.id, value: collection.id },
            `${'·'.repeat(collection.level)} ${collection.name}`,
          )),
        ),
        h('button', { type: 'button', disabled: !model.canSave, onClick: () => { void onSave() } }, '写入 Zotero'),
        model.saveHint ? h('span', { style: hintStyle }, model.saveHint) : null,
      ),
      state.notice ? h('p', null, state.notice) : null,
      state.message ? h('p', null, state.message) : null,
      model.rows.length === 0
        ? h('p', null, '还没有收集到文献')
        : h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          h('thead', null, h('tr', null, ['', '题名', '作者', '年份', '文件', '库'].map(label => h('th', { key: label, style: cellStyle }, label)))),
          h('tbody', null, model.rows.map(ref => h('tr', { key: ref.id },
            h('td', { style: cellStyle }, h('input', {
              type: 'checkbox',
              'aria-label': `选择 ${ref.title}`,
              checked: state.selected.includes(ref.id),
              onChange: () => dispatch({ type: 'toggle', id: ref.id }),
            })),
            h('td', { style: cellStyle }, h('button', { type: 'button', onClick: () => dispatch({ type: 'preview', id: ref.id }) }, ref.title)),
            h('td', { style: cellStyle }, shortAuthors(ref.authors)),
            h('td', { style: cellStyle }, ref.year || ''),
            h('td', { style: cellStyle }, ref.hasPdf ? '有 PDF' : '仅链接'),
            h('td', { style: cellStyle }, [
              ref.inLibrary ? '已在库' : '',
              ref.proposal ? '待确认题录' : '',
            ].filter(Boolean).join(' ')),
          ))),
        ),
      model.preview ? h('aside', { style: { marginTop: 12 } },
        h('h2', { style: { fontSize: 16 } }, model.preview.title),
        h('p', null, [model.preview.authors, model.preview.year].filter(Boolean).join(' · ')),
        model.preview.publicationTitle
          ? h('p', null, [model.preview.publicationTitle, model.preview.volume, model.preview.issue, model.preview.pages].filter(Boolean).join(' '))
          : null,
        model.preview.doi || model.preview.arxiv
          ? h('p', null, model.preview.doi ? `DOI ${model.preview.doi}` : `arXiv ${model.preview.arxiv}`)
          : null,
        h('p', null, [
          model.preview.hasPdf ? '有 PDF' : '没有 PDF',
          model.preview.hasHtml ? '有网页快照' : '',
          model.preview.inLibrary ? '已在库' : '',
          model.preview.resolved ? '题录已按规范记录补全' : '',
        ].filter(Boolean).join(' · ')),
        model.preview.url ? h('p', null, model.preview.url) : null,
        model.preview.abstract ? h('p', null, model.preview.abstract) : null,
        model.preview.proposal
          ? h('div', { style: proposalStyle },
            h('strong', null, '模型建议的题录（还没采用）'),
            h('p', null, model.preview.proposal.title || '(没有题名)'),
            h('p', null, [
              model.preview.proposal.authors,
              model.preview.proposal.year,
              model.preview.proposal.publicationTitle,
              model.preview.proposal.doi,
            ].filter(Boolean).join(' · ')),
            h('button', { type: 'button', onClick: () => { void onConfirm(model.preview.id, true) } }, '采用'),
            ' ',
            h('button', { type: 'button', onClick: () => { void onConfirm(model.preview.id, false) } }, '忽略'),
          )
          : null,
        !model.preview.proposal && model.preview.canPropose
          ? h('button', { type: 'button', onClick: () => { void onPropose(model.preview.id) } }, '让模型补题录')
          : null,
      ) : null,
    )

    async function onPropose(id) {
      dispatch({ type: 'message', text: '正在让模型读这一行…' })
      const result = await post({ op: 'propose', sessionId, id })
      if (!result.ok) {
        dispatch({ type: 'message', text: result.error || '模型补题录失败' })
        return
      }
      dispatch({ type: 'message', text: '模型给出了建议，确认后才会写进条目' })
    }

    async function onConfirm(id, accept) {
      const result = await post({ op: 'confirm', sessionId, id, accept })
      dispatch({ type: 'message', text: result.ok ? (accept ? '已采用模型建议' : '已忽略模型建议') : (result.error || '操作失败') })
    }
  }

  return {
    inject: ['betterSidebar'],
    apply(ctx) {
      if (!ctx.betterSidebar) return
      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: 'dsh-refs2zotero:library',
        title: () => '参考文献',
        order: 60,
        single: true,
        icon: (size) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('rect', { x: 3, y: 2, width: 10, height: 12, rx: 1, fill: 'none', stroke: 'currentColor' }),
          h('path', { d: 'M6 2v12', stroke: 'currentColor' }),
        ),
        component: ({ scope, visible }) => h(Panel, { sessionId: scope.sessionId, visible }),
      }))
    },
  }
}

/**
 * Keep the list column narrow: first author plus 等 when there are more.
 * @param {unknown} authors
 */
function shortAuthors(authors) {
  const text = typeof authors === 'string' ? authors.trim() : ''
  if (!text) return ''
  const parts = text.split(',').map(part => part.trim()).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} 等` : text
}

async function post(body) {
  try {
    const response = await fetch('/dsh-refs2zotero/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await response.json()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '请求失败' }
  }
}

const pageStyle = { padding: 12, font: '13px/1.4 sans-serif', color: 'inherit' }
const toolbarStyle = { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }
const inputStyle = { flex: '1 1 160px' }
const cellStyle = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #ddd', verticalAlign: 'top' }
const proposalStyle = { marginTop: 8, padding: 8, border: '1px dashed #b58', borderRadius: 4 }
const hintStyle = { alignSelf: 'center', opacity: 0.7 }
