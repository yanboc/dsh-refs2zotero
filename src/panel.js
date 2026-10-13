import { collectionStorageKey, initialState, reduce, viewModel } from './view.js'
import { GLYPH, createAtoms, ensureStyle } from './ui.js'

/**
 * @param {typeof import('react')} React
 */
export function createApply(React) {
  const { createElement: h, useEffect, useReducer } = React
  const { IconButton, Chip, Glyph } = createAtoms(React)
  ensureStyle()

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
      const parts = [`已写入 ${result.saved?.length ?? 0} 条`]
      if (result.skipped?.length) parts.push(`已在库 ${result.skipped.length} 条`)
      for (const item of result.failed ?? []) parts.push(item.reason)
      for (const item of result.warnings ?? []) parts.push(item.reason)
      dispatch({ type: 'message', text: parts.join('，') })
    }

    async function onPropose(id) {
      dispatch({ type: 'message', text: '正在让模型读这一行…' })
      const result = await post({ op: 'propose', sessionId, id })
      dispatch({ type: 'message', text: result.ok ? '模型给出了建议，采用后才会写进条目' : (result.error || '模型补题录失败') })
    }

    async function onConfirm(id, accept) {
      const result = await post({ op: 'confirm', sessionId, id, accept })
      dispatch({ type: 'message', text: result.ok ? (accept ? '已采用模型建议' : '已忽略模型建议') : (result.error || '操作失败') })
    }

    async function onFindPdf(ids) {
      if (ids.length === 0) return
      dispatch({ type: 'fetching', ids })
      dispatch({ type: 'message', text: '正在找可下载的 PDF…' })
      const result = await post({ op: 'fetchPdf', sessionId, ids })
      dispatch({ type: 'fetching', ids: [] })
      if (!result.ok) {
        dispatch({ type: 'message', text: result.error || '找 PDF 失败' })
        return
      }
      const ok = (result.results ?? []).filter(item => item.ok)
      const parts = [`找到 ${ok.length} 个 PDF`]
      for (const item of (result.results ?? []).filter(item => !item.ok)) parts.push(item.error)
      dispatch({ type: 'message', text: parts.join('，') })
    }

    async function onForget(id) {
      dispatch({ type: 'remove', id })
      const result = await post({ op: 'forget', sessionId, id })
      if (!result.ok) dispatch({ type: 'message', text: result.error || '忽略失败' })
    }

    /** One entry: the title owns the first line, everything else the second. */
    function renderItem(ref) {
      const selected = state.selected.includes(ref.id)
      const expanded = state.previewId === ref.id
      const busy = state.fetching.includes(ref.id)
      const meta = [shortAuthors(ref.authors), ref.year, ref.publicationTitle].filter(Boolean)
      return h('div', {
        key: ref.id,
        className: 'zr-item',
        'data-selected': selected ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        'aria-pressed': selected,
        title: selected ? '点击取消选择' : '点击选择这一条',
        onClick: () => dispatch({ type: 'toggle', id: ref.id }),
        onKeyDown: event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          dispatch({ type: 'toggle', id: ref.id })
        },
      },
        h('div', { className: 'zr-title' }, ref.title || '(没有题名)'),
        h('div', { className: 'zr-meta' },
          meta.length > 0 ? h('span', { className: 'zr-metaText' }, meta.join(' · ')) : null,
          ref.inLibrary ? h(Chip, { tone: 'muted' }, '已在库') : null,
          ref.hasPdf ? h(Chip, { tone: 'muted' }, '有 PDF') : null,
          ref.proposal ? h(Chip, { tone: 'business' }, '待确认题录') : null,
          h('span', { className: 'zr-actions' },
            h(IconButton, {
              title: busy ? '正在找 PDF…' : '找可下载的 PDF',
              disabled: busy,
              onClick: () => { void onFindPdf([ref.id]) },
            }, h(Glyph, { path: GLYPH.download })),
            h(IconButton, { title: '忽略这一条（不动 Zotero）', danger: true, onClick: () => { void onForget(ref.id) } },
              h(Glyph, { path: GLYPH.close })),
            h(IconButton, {
              title: expanded ? '收起预览' : '展开预览',
              onClick: () => dispatch({ type: 'preview', id: ref.id }),
            }, h(Glyph, { path: GLYPH.chevron })),
          ),
        ),
        expanded ? renderPreview(ref) : null,
      )
    }

    function renderPreview(ref) {
      const identifier = ref.doi ? `DOI ${ref.doi}` : (ref.arxiv ? `arXiv ${ref.arxiv}` : '')
      const venue = [ref.publicationTitle, ref.volume, ref.issue, ref.pages].filter(Boolean).join(' ')
      return h('div', { className: 'zr-preview' },
        ref.authors ? h('div', { className: 'zr-line' }, ref.authors) : null,
        venue ? h('div', { className: 'zr-line' }, venue) : null,
        identifier ? h('div', { className: 'zr-line' }, identifier) : null,
        ref.url ? h('div', { className: 'zr-line' }, ref.url) : null,
        h('div', { className: 'zr-line' },
          [
            ref.hasPdf ? '有 PDF' : '没有 PDF',
            ref.hasHtml ? '有网页快照' : '',
            ref.inLibrary ? '已在库' : '',
            ref.resolved ? '题录已按规范记录补全' : '',
          ].filter(Boolean).join(' · ')),
        ref.abstract ? h('div', { className: 'zr-abstract' }, ref.abstract) : null,
        ref.proposal
          ? h('div', { className: 'zr-proposal' },
            h('div', { className: 'zr-proposalHead' }, '模型建议的题录（还没采用）'),
            h('div', { className: 'zr-line' }, ref.proposal.title || '(没有题名)'),
            h('div', { className: 'zr-line' },
              [ref.proposal.authors, ref.proposal.year, ref.proposal.publicationTitle, ref.proposal.doi].filter(Boolean).join(' · ')),
            h('div', { className: 'zr-inlineActions' },
              h('button', { type: 'button', className: 'zr-button', onClick: event => { event.stopPropagation(); void onConfirm(ref.id, true) } }, '采用'),
              h('button', { type: 'button', className: 'zr-button', onClick: event => { event.stopPropagation(); void onConfirm(ref.id, false) } }, '忽略'),
            ),
          )
          : ref.canPropose
            ? h('div', { className: 'zr-inlineActions' },
              h('button', { type: 'button', className: 'zr-button', onClick: event => { event.stopPropagation(); void onPropose(ref.id) } }, '让模型补题录'),
            )
            : null,
      )
    }

    return h('div', { className: 'zr-root' },
      h('div', { className: 'zr-head' },
        h('input', {
          className: 'zr-search',
          'aria-label': '搜索',
          placeholder: '搜索题名、作者、DOI',
          value: state.query,
          onChange: event => dispatch({ type: 'query', query: event.target.value }),
        }),
        h('button', {
          type: 'button',
          className: 'zr-button',
          onClick: () => dispatch({ type: 'selectAll' }),
        }, model.allSelected ? '取消全选' : '全选'),
      ),
      h('div', { className: 'zr-scroll' },
        h('div', { className: 'zr-band' },
          h('span', { className: 'zr-bandLabel' }, '参考文献'),
          h('span', { className: 'zr-bandCount' }, `${model.rows.length}/${state.refs.length}`),
          state.selected.length > 0
            ? h('span', { className: 'zr-bandAction' },
              h(IconButton, {
                title: `为选中的 ${state.selected.length} 条找 PDF`,
                onClick: () => { void onFindPdf(state.selected) },
              }, h(Glyph, { path: GLYPH.download })),
            )
            : null,
        ),
        model.rows.length === 0
          ? h('div', { className: 'zr-empty' }, state.refs.length === 0 ? '这一会话还没有读到文献' : '没有匹配的行')
          : h('div', { className: 'zr-list' }, model.rows.map(renderItem)),
      ),
      state.notice ? h('div', { className: 'zr-notice', 'data-tone': 'error' }, state.notice) : null,
      state.message ? h('div', { className: 'zr-notice' }, state.message) : null,
      h('div', { className: 'zr-foot' },
        h('div', { className: 'zr-footRow' },
          h('select', {
            className: 'zr-select',
            'aria-label': '分类',
            value: state.collectionId,
            onChange: event => dispatch({ type: 'collection', id: event.target.value }),
          },
            h('option', { value: '' }, '选择已有分类'),
            ...state.collections.map(collection => h('option', { key: collection.id, value: collection.id },
              `${'·'.repeat(collection.level)} ${collection.name}`,
            )),
          ),
          h('button', {
            type: 'button',
            className: 'zr-primary',
            disabled: !model.canSave,
            onClick: () => { void onSave() },
          }, state.saving ? '写入中…' : '写入 Zotero'),
        ),
        model.saveHint ? h('div', { className: 'zr-hint' }, model.saveHint) : null,
      ),
    )
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
        icon: (size) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 },
          h('rect', { x: 3, y: 2, width: 10, height: 12, rx: 1 }),
          h('path', { d: 'M6 2v12' }),
        ),
        component: ({ scope, visible }) => h(Panel, { sessionId: scope.sessionId, visible }),
      }))
    },
  }
}

/**
 * Keep the second line short: first author plus 等 when there are more.
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
