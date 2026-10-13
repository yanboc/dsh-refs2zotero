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
    const visible = filterRefs(state.refs, state.query).map(ref => ref.id)
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
  if (action.type === 'fetching') return { ...state, fetching: action.ids ?? [] }
  if (action.type === 'remove') {
    return {
      ...state,
      refs: state.refs.filter(ref => ref.id !== action.id),
      selected: state.selected.filter(id => id !== action.id),
      previewId: state.previewId === action.id ? null : state.previewId,
    }
  }
  if (action.type === 'message') return { ...state, message: action.text ?? '' }
  if (action.type === 'saving') return { ...state, saving: Boolean(action.value) }
  return state
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
 * @param {PanelState} state
 */
export function viewModel(state) {
  const rows = filterRefs(state.refs, state.query)
  const preview = state.refs.find(ref => ref.id === state.previewId) ?? null
  const canSave = state.selected.length > 0 && state.collectionId.length > 0 && !state.saving
  return {
    rows,
    preview,
    allSelected: rows.length > 0 && rows.every(ref => state.selected.includes(ref.id)),
    canSave,
    saveHint: saveHint(state, canSave),
  }
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
