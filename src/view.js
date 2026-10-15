/**
 * @returns {PanelState}
 */
export function initialState() {
  return {
    query: '',
    selected: [],
    previewId: null,
    collectionId: '',
    collections: [],
    refs: [],
    message: '',
    notice: '',
    saving: false,
    fetching: [],
    sortKey: 'title',
    sortAsc: true,
    showArchived: false,
    flash: { collection: 0, rows: 0 },
    conflicts: [],
    conflictSelected: [],
    conflictAction: 'overwrite',
    resolvingConflicts: false,
  }
}

/**
 * @param {string} sessionId
 */
export function collectionStorageKey(sessionId) {
  return `dsh-refs2zotero:${sessionId}`
}

/**
 * @param {PanelState} state
 * @param {{ type: string, [key: string]: any }} action
 * @returns {PanelState}
 */
export function reduce(state, action) {
  if (action.type === 'sync') {
    // A failed poll omits a field rather than sending an empty one: blanking the
    // list or the collection choices because Zotero hiccuped once would drop the
    // user's selection and make the write button inexplicably dead.
    const refs = action.refs ?? state.refs
    const collections = action.collections ?? state.collections
    const ids = new Set(refs.map(ref => ref.id))
    return {
      ...state,
      refs,
      collections,
      notice: action.error || '',
      selected: state.selected.filter(id => ids.has(id)),
      previewId: state.previewId && ids.has(state.previewId) ? state.previewId : null,
    }
  }
  if (action.type === 'query') return { ...state, query: action.query ?? '' }
  if (action.type === 'toggle') {
    const selected = state.selected.includes(action.id)
      ? state.selected.filter(id => id !== action.id)
      : [...state.selected, action.id]
    return { ...state, selected }
  }
  if (action.type === 'selectAll') {
    const visible = visibleRows(state).map(ref => ref.id)
    const allOn = visible.length > 0 && visible.every(id => state.selected.includes(id))
    const selected = allOn
      ? state.selected.filter(id => !visible.includes(id))
      : [...new Set([...state.selected, ...visible])]
    return { ...state, selected }
  }
  if (action.type === 'preview') {
    return { ...state, previewId: state.previewId === action.id ? null : action.id }
  }
  if (action.type === 'collection') return { ...state, collectionId: action.id ?? '' }
  if (action.type === 'sort') return { ...state, sortKey: action.key ?? state.sortKey }
  if (action.type === 'order') return { ...state, sortAsc: !state.sortAsc }
  if (action.type === 'toggleArchived') return { ...state, showArchived: !state.showArchived }
  if (action.type === 'setArchived') {
    return {
      ...state,
      refs: state.refs.map(ref => (ref.id === action.id ? { ...ref, archived: Boolean(action.value) } : ref)),
    }
  }
  if (action.type === 'fetching') return { ...state, fetching: action.ids ?? [] }
  if (action.type === 'flash') {
    return {
      ...state,
      flash: {
        collection: state.flash.collection + (action.collection ? 1 : 0),
        rows: state.flash.rows + (action.rows ? 1 : 0),
      },
    }
  }
  if (action.type === 'message') return { ...state, message: action.text ?? '' }
  if (action.type === 'saving') return { ...state, saving: Boolean(action.value) }
  if (action.type === 'conflicts') {
    const conflicts = action.conflicts ?? []
    return { ...state, conflicts, conflictSelected: conflicts.map(conflict => conflict.id), conflictAction: 'overwrite' }
  }
  if (action.type === 'conflictSelect') {
    const conflictSelected = state.conflictSelected.includes(action.id)
      ? state.conflictSelected.filter(id => id !== action.id)
      : [...state.conflictSelected, action.id]
    return { ...state, conflictSelected }
  }
  if (action.type === 'conflictSelectAll') {
    const all = state.conflicts.map(conflict => conflict.id)
    const allOn = all.length > 0 && all.every(id => state.conflictSelected.includes(id))
    return { ...state, conflictSelected: allOn ? [] : all }
  }
  if (action.type === 'conflictAction') return { ...state, conflictAction: action.action ?? 'overwrite' }
  if (action.type === 'conflictResolved') {
    const done = new Set(action.ids ?? [])
    return {
      ...state,
      conflicts: state.conflicts.filter(conflict => !done.has(conflict.id)),
      conflictSelected: state.conflictSelected.filter(id => !done.has(id)),
    }
  }
  if (action.type === 'resolvingConflicts') return { ...state, resolvingConflicts: Boolean(action.value) }
  return state
}

/**
 * The rows in the order the user asked to see them: search, then the archived
 * gate, then the sort.
 * @param {PanelState} state
 * @returns {any[]}
 */
export function visibleRows(state) {
  const searched = filterRefs(state.refs, state.query)
  const shown = state.showArchived ? searched : searched.filter(ref => !ref.archived)
  return sortRefs(shown, state.sortKey, state.sortAsc)
}

/**
 * @param {Array<{ id: string, title?: string, authors?: string, doi?: string, url?: string }>} refs
 * @param {string} query
 */
export function filterRefs(refs, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return refs
  return refs.filter(ref => [ref.title, ref.authors, ref.doi, ref.url].some(field =>
    typeof field === 'string' && field.toLowerCase().includes(needle),
  ))
}

/**
 * @param {Array<{ id: string, title?: string, authors?: string, year?: string }>} refs
 * @param {string} key
 * @param {boolean} asc
 */
export function sortRefs(refs, key, asc) {
  const byKey = {
    title: ref => String(ref.title ?? '').toLowerCase(),
    authors: ref => String(ref.authors ?? '').toLowerCase(),
    year: ref => {
      const year = Number(ref.year)
      // Number('') is 0, so treat an empty/missing year as "no year", not 0.
      return (ref.year === '' || ref.year == null || !Number.isFinite(year)) ? Number.POSITIVE_INFINITY : year
    },
  }[key] ?? (ref => String(ref.title ?? '').toLowerCase())

  // Rows without a value for the key always sink to the bottom, whichever
  // direction: an entry with no year is the least useful in either order.
  const valued = refs.filter(ref => byKey(ref) !== Number.POSITIVE_INFINITY)
  const missing = refs.filter(ref => byKey(ref) === Number.POSITIVE_INFINITY)
  const sorted = valued.sort((left, right) => {
    const a = byKey(left)
    const b = byKey(right)
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b))
  })
  return asc ? [...sorted, ...missing] : [...sorted.reverse(), ...missing]
}

/**
 * @param {PanelState} state
 */
export function viewModel(state) {
  const rows = visibleRows(state)
  const preview = state.refs.find(ref => ref.id === state.previewId) ?? null
  const canSave = state.selected.length > 0 && state.collectionId.length > 0 && !state.saving
  const archivedCount = state.refs.filter(ref => ref.archived).length
  return {
    rows,
    preview,
    allSelected: rows.length > 0 && rows.every(ref => state.selected.includes(ref.id)),
    canSave,
    saveHint: saveHint(state, canSave),
    archivedCount,
  }
}

/**
 * What the metadata badge does for a row, or null when it is a plain label.
 * A DOI or arXiv id is enough to fetch the canonical record, so an untitled
 * row can still refresh its metadata; a row with only an excerpt falls back
 * to asking the model; a row with neither has nothing to fetch.
 * @param {{ resolved?: boolean, proposal?: unknown, doi?: string, arxiv?: string, canPropose?: boolean }} ref
 * @returns {'refresh' | 'propose' | null}
 */
export function metaBadgeAction(ref) {
  if (ref.resolved) return 'refresh'
  if (ref.proposal) return null
  if (ref.doi || ref.arxiv) return 'refresh'
  if (ref.canPropose) return 'propose'
  return null
}

/**
 * Say why the write button is disabled. A grey button with no reason reads as a
 * broken page; the user cannot tell "pick a collection first" from "nothing is
 * selected".
 * @param {PanelState} state
 * @param {boolean} canSave
 * @returns {string}
 */
export function saveHint(state, canSave) {
  if (canSave) return ''
  if (state.saving) return '正在写入…'
  if (state.selected.length === 0) return '先勾选要写入的文献'
  if (state.collections.length === 0) return '读不到 Zotero 分类；确认桌面端 Zotero 开着'
  if (state.collectionId.length === 0) return '再选一个已有的分类'
  return ''
}
