import { collectionStorageKey, initialState, metaBadgeAction, reduce, viewModel } from './view.js'
import { GLYPH, createAtoms, ensureStyle } from './ui.js'

/**
 * @param {typeof import('react')} React
 */
export function createApply(React) {
  const { createElement: h, useEffect, useReducer, useState } = React
  const { IconButton, Badge, Glyph } = createAtoms(React)
  ensureStyle()

  /** A labelled metadata line: "作者" before the value. */
  function Field(key, value) {
    return h('div', { className: 'zr-field' },
      h('span', { className: 'zr-key' }, key),
      h('span', { className: 'zr-fieldValue' }, value),
    )
  }

  /** The abstract, collapsed by default so long previews stay scannable. */
  function AbstractBlock({ text }) {
    const [open, setOpen] = useState(false)
    return h('div', null,
      h('button', {
        type: 'button',
        className: 'zr-abstractToggle',
        'aria-expanded': open,
        onClick: event => { event.stopPropagation(); setOpen(!open) },
      },
        h('span', { className: 'zr-key' }, '摘要'),
        h(Glyph, { paths: open ? GLYPH.chevronUp : GLYPH.chevronDown, size: 12 }),
      ),
      open ? h('div', { className: 'zr-abstract' }, text) : null,
    )
  }

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

    async function onSave(ids) {
      if (ids.length === 0) return
      dispatch({ type: 'saving', value: true })
      dispatch({ type: 'message', text: '' })
      const result = await post({ op: 'save', sessionId, ids, collectionId: state.collectionId })
      dispatch({ type: 'saving', value: false })
      if (!result.ok) {
        dispatch({ type: 'message', text: result.error || '保存失败' })
        return
      }
      const conflicts = result.conflicts ?? []
      if (conflicts.length > 0) dispatch({ type: 'conflicts', conflicts })
      const parts = [`已写入 ${result.saved?.length ?? 0} 条`]
      if (conflicts.length > 0) parts.push(`${conflicts.length} 条已在库里，请在下方选择处理方式`)
      for (const item of result.failed ?? []) parts.push(item.reason)
      for (const item of result.warnings ?? []) parts.push(item.reason)
      dispatch({ type: 'message', text: parts.join('，') })
    }

    async function onResolveConflicts() {
      if (state.conflictSelected.length === 0) {
        dispatch({ type: 'flash', rows: true })
        return
      }
      dispatch({ type: 'resolvingConflicts', value: true })
      dispatch({ type: 'message', text: '' })
      const result = await post({
        op: 'resolveConflicts',
        sessionId,
        collectionId: state.collectionId,
        action: state.conflictAction,
        ids: state.conflictSelected,
      })
      dispatch({ type: 'resolvingConflicts', value: false })
      if (!result.ok) {
        dispatch({ type: 'message', text: result.error || '处理冲突失败' })
        return
      }
      const results = result.results ?? []
      const okCount = results.filter(item => item.ok).length
      dispatch({ type: 'conflictResolved', ids: state.conflictSelected })
      dispatch({ type: 'message', text: `已处理 ${okCount}/${results.length} 条冲突` })
    }

    async function onAddToLibrary(id) {
      if (!state.collectionId) {
        dispatch({ type: 'flash', collection: true })
        return
      }
      await onSave([id])
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

    async function onRefreshMeta(ref) {
      if (ref.doi || ref.arxiv) {
        dispatch({ type: 'message', text: '正在重新抓取题录…' })
        const result = await post({ op: 'refresh', sessionId, id: ref.id })
        dispatch({ type: 'message', text: result.ok ? '题录已更新' : (result.error || '更新失败') })
        return
      }
      await onPropose(ref.id)
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

    async function onToggleArchived(id, currentlyArchived) {
      dispatch({ type: 'setArchived', id, value: !currentlyArchived })
      const result = await post({ op: currentlyArchived ? 'unarchive' : 'archive', sessionId, id })
      if (!result.ok) {
        dispatch({ type: 'setArchived', id, value: currentlyArchived })
        dispatch({ type: 'message', text: result.error || '操作失败' })
      }
    }

    function onWriteClick() {
      if (model.canSave) {
        void onSave(state.selected)
        return
      }
      if (state.selected.length === 0) dispatch({ type: 'flash', rows: true })
      if (!state.collectionId) dispatch({ type: 'flash', collection: true })
    }

    function renderItem(ref) {
      const selected = state.selected.includes(ref.id)
      const expanded = state.previewId === ref.id
      const busy = state.fetching.includes(ref.id)
      const metaAction = metaBadgeAction(ref)
      const meta = [shortAuthors(ref.authors), ref.year, ref.publicationTitle].filter(Boolean)
      return h('div', {
        key: ref.id,
        className: 'zr-item',
        'data-selected': selected ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        'aria-pressed': selected,
        'aria-expanded': expanded,
        style: ref.archived ? { opacity: 0.55 } : undefined,
        onClick: () => dispatch({ type: 'preview', id: ref.id }),
        onKeyDown: event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          dispatch({ type: 'preview', id: ref.id })
        },
      },
        h('div', { className: 'zr-line1' },
          h('input', {
            type: 'checkbox',
            className: 'zr-check',
            'aria-label': `勾选 ${ref.title || '这条文献'}`,
            checked: selected,
            onClick: event => event.stopPropagation(),
            onChange: () => dispatch({ type: 'toggle', id: ref.id }),
          }),
          h('div', { className: 'zr-title' }, ref.title || '(没有题名)'),
        ),
        h('div', { className: 'zr-meta' },
          meta.length > 0 ? h('span', { className: 'zr-metaText' }, meta.join(' · ')) : null,
          h(Badge, {
            rest: ref.inLibrary ? '已在库' : '未入库',
            hover: '加入库',
            tone: ref.inLibrary ? 'muted' : undefined,
            onClick: ref.inLibrary ? undefined : (() => { void onAddToLibrary(ref.id) }),
          }),
          h(Badge, {
            rest: ref.hasPdf ? '已有PDF' : '暂无PDF',
            hover: ref.hasPdf ? '更新PDF' : '查找PDF',
            tone: ref.hasPdf ? 'muted' : undefined,
            onClick: () => { void onFindPdf([ref.id]) },
            disabled: busy,
          }),
          h(Badge, {
            rest: ref.resolved ? '已有元信息' : (ref.proposal ? '待确认题录' : '暂无元信息'),
            hover: ref.resolved ? '更新元信息' : '查找元信息',
            tone: ref.proposal ? 'business' : (ref.resolved ? 'muted' : undefined),
            onClick: metaAction === 'refresh' ? (() => { void onRefreshMeta(ref) })
              : metaAction === 'propose' ? (() => { void onPropose(ref.id) })
              : undefined,
          }),
          h('span', { className: 'zr-actions' },
            h(IconButton, {
              title: ref.archived ? '取消归档' : '归档（隐藏这一条）',
              active: ref.archived,
              onClick: () => { void onToggleArchived(ref.id, Boolean(ref.archived)) },
            }, h(Glyph, { paths: ref.archived ? GLYPH.restore : GLYPH.archive })),
          ),
        ),
        expanded ? renderPreview(ref) : null,
      )
    }

    function renderPreview(ref) {
      const identifier = ref.arxiv ? ['arXiv', ref.arxiv] : (ref.doi ? ['DOI', ref.doi] : null)
      const venue = [ref.publicationTitle, ref.volume, ref.issue, ref.pages].filter(Boolean).join(' ')
      const status = [
        ref.hasPdf ? '有 PDF' : '没有 PDF',
        ref.hasHtml ? '有网页快照' : '',
        ref.inLibrary ? '已在库' : '',
        ref.resolved ? '题录已按规范记录补全' : '',
      ].filter(Boolean).join(' · ')
      return h('div', { className: 'zr-preview' },
        ref.authors ? Field('作者', ref.authors) : null,
        venue ? Field('期刊', venue) : null,
        ref.year ? Field('年份', ref.year) : null,
        identifier ? Field(identifier[0], identifier[1]) : null,
        ref.url ? Field('链接', ref.url) : null,
        status ? Field('状态', status) : null,
        ref.abstract ? h(AbstractBlock, { text: ref.abstract }) : null,
        ref.why ? Field('备注', ref.why) : null,
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
          : null,
      )
    }

    function renderConflicts() {
      const allOn = state.conflicts.length > 0 && state.conflictSelected.length === state.conflicts.length
      return h('div', { className: 'zr-conflict' },
        h('div', { className: 'zr-conflictHead' },
          h('span', null, `有 ${state.conflicts.length} 条文献已在库里`),
          h('button', { type: 'button', className: 'zr-button', onClick: () => dispatch({ type: 'conflictSelectAll' }) },
            allOn ? '取消全选' : '全选'),
        ),
        h('div', { className: 'zr-conflictList' },
          state.conflicts.map(conflict => {
            const ref = state.refs.find(row => row.id === conflict.id)
            const selected = state.conflictSelected.includes(conflict.id)
            return h('div', { className: 'zr-conflictRow', key: conflict.id },
              h('input', {
                type: 'checkbox',
                className: 'zr-check',
                'aria-label': `处理 ${ref?.title || conflict.existingTitle || '这条文献'}`,
                checked: selected,
                onChange: () => dispatch({ type: 'conflictSelect', id: conflict.id }),
              }),
              h('div', { className: 'zr-conflictText' },
                h('div', { className: 'zr-conflictTitle' }, ref?.title || '(没有题名)'),
                conflict.existingTitle ? h('div', { className: 'zr-conflictExisting' }, `库里已有：${conflict.existingTitle}`) : null,
              ),
            )
          }),
        ),
        h('div', { className: 'zr-conflictActions' },
          h('select', {
            className: 'zr-control',
            'aria-label': '冲突处理方式',
            value: state.conflictAction,
            onChange: event => dispatch({ type: 'conflictAction', action: event.target.value }),
          },
            h('option', { value: 'overwrite' }, '覆盖库里的条目'),
            h('option', { value: 'duplicate' }, '两者都要（新建一条）'),
            h('option', { value: 'cancel' }, '取消（不写入这些）'),
          ),
          h('button', {
            type: 'button',
            className: 'zr-primary',
            disabled: state.conflictSelected.length === 0 || state.resolvingConflicts,
            onClick: () => { void onResolveConflicts() },
          }, state.resolvingConflicts ? '处理中…' : '确认处理'),
        ),
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
        h(IconButton, {
          title: state.showArchived ? '隐藏已归档' : '显示已归档',
          active: state.showArchived,
          onClick: () => dispatch({ type: 'toggleArchived' }),
        }, h(Glyph, { paths: GLYPH.eye })),
      ),
      state.conflicts.length > 0 ? renderConflicts() : null,
      h('div', { className: 'zr-scroll' },
        h('div', { className: 'zr-band' },
          h('select', {
            className: 'zr-control',
            'aria-label': '排序',
            value: state.sortKey,
            onChange: event => dispatch({ type: 'sort', key: event.target.value }),
          },
            h('option', { value: 'title' }, '按标题'),
            h('option', { value: 'authors' }, '按作者'),
            h('option', { value: 'year' }, '按年份'),
          ),
          h(IconButton, {
            title: state.sortAsc ? '升序（点击切换为降序）' : '降序（点击切换为升序）',
            onClick: () => dispatch({ type: 'order' }),
          }, h(Glyph, { paths: state.sortAsc ? GLYPH.arrowUp : GLYPH.arrowDown })),
          h('span', { className: 'zr-bandCount' }, `${model.rows.length}/${state.refs.length}`),
          state.selected.length > 0
            ? h('span', { className: 'zr-bandAction' },
              h(IconButton, {
                title: `为选中的 ${state.selected.length} 条找 PDF`,
                onClick: () => { void onFindPdf(state.selected) },
              }, h(Glyph, { paths: GLYPH.download })),
            )
            : null,
        ),
        model.rows.length === 0
          ? h('div', { className: 'zr-empty' }, state.refs.length === 0 ? '这一会话还没有读到文献' : '没有匹配的行')
          : h('div', {
            className: state.flash.rows ? 'zr-list zr-flash' : 'zr-list',
            key: `rows-${state.flash.rows}`,
          }, model.rows.map(renderItem)),
      ),
      state.notice ? h('div', { className: 'zr-notice', 'data-tone': 'error' }, state.notice) : null,
      state.message ? h('div', { className: 'zr-notice' }, state.message) : null,
      h('div', { className: 'zr-foot' },
        h('div', { className: 'zr-footRow' },
          h('select', {
            className: state.flash.collection ? 'zr-select zr-flash' : 'zr-select',
            key: `coll-${state.flash.collection}`,
            'aria-label': '分类',
            value: state.collectionId,
            onChange: event => dispatch({ type: 'collection', id: event.target.value }),
          },
            h('option', { value: '' }, '选择已有分类'),
            ...state.collections.map(collection => h('option', { key: collection.id, value: collection.id },
              collection.path || collection.name,
            )),
          ),
          h('button', {
            type: 'button',
            className: 'zr-primary',
            'data-disabled': model.canSave ? 'false' : 'true',
            'aria-disabled': !model.canSave,
            onClick: onWriteClick,
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
