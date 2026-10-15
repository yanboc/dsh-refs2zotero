"use strict";
(() => {
  // src/view.js
  function initialState() {
    return {
      query: "",
      selected: [],
      previewId: null,
      collectionId: "",
      collections: [],
      refs: [],
      message: "",
      notice: "",
      saving: false,
      fetching: [],
      sortKey: "title",
      sortAsc: true,
      showArchived: false,
      flash: { collection: 0, rows: 0 },
      conflicts: [],
      conflictSelected: [],
      conflictAction: "overwrite",
      resolvingConflicts: false
    };
  }
  function collectionStorageKey(sessionId) {
    return `dsh-refs2zotero:${sessionId}`;
  }
  function reduce(state, action) {
    if (action.type === "sync") {
      const refs = action.refs ?? state.refs;
      const collections = action.collections ?? state.collections;
      const ids = new Set(refs.map((ref) => ref.id));
      return {
        ...state,
        refs,
        collections,
        notice: action.error || "",
        selected: state.selected.filter((id) => ids.has(id)),
        previewId: state.previewId && ids.has(state.previewId) ? state.previewId : null
      };
    }
    if (action.type === "query") return { ...state, query: action.query ?? "" };
    if (action.type === "toggle") {
      const selected = state.selected.includes(action.id) ? state.selected.filter((id) => id !== action.id) : [...state.selected, action.id];
      return { ...state, selected };
    }
    if (action.type === "selectAll") {
      const visible = visibleRows(state).map((ref) => ref.id);
      const allOn = visible.length > 0 && visible.every((id) => state.selected.includes(id));
      const selected = allOn ? state.selected.filter((id) => !visible.includes(id)) : [.../* @__PURE__ */ new Set([...state.selected, ...visible])];
      return { ...state, selected };
    }
    if (action.type === "preview") {
      return { ...state, previewId: state.previewId === action.id ? null : action.id };
    }
    if (action.type === "collection") return { ...state, collectionId: action.id ?? "" };
    if (action.type === "sort") return { ...state, sortKey: action.key ?? state.sortKey };
    if (action.type === "order") return { ...state, sortAsc: !state.sortAsc };
    if (action.type === "toggleArchived") return { ...state, showArchived: !state.showArchived };
    if (action.type === "setArchived") {
      return {
        ...state,
        refs: state.refs.map((ref) => ref.id === action.id ? { ...ref, archived: Boolean(action.value) } : ref)
      };
    }
    if (action.type === "fetching") return { ...state, fetching: action.ids ?? [] };
    if (action.type === "flash") {
      return {
        ...state,
        flash: {
          collection: state.flash.collection + (action.collection ? 1 : 0),
          rows: state.flash.rows + (action.rows ? 1 : 0)
        }
      };
    }
    if (action.type === "message") return { ...state, message: action.text ?? "" };
    if (action.type === "saving") return { ...state, saving: Boolean(action.value) };
    if (action.type === "conflicts") {
      const conflicts = action.conflicts ?? [];
      return { ...state, conflicts, conflictSelected: conflicts.map((conflict) => conflict.id), conflictAction: "overwrite" };
    }
    if (action.type === "conflictSelect") {
      const conflictSelected = state.conflictSelected.includes(action.id) ? state.conflictSelected.filter((id) => id !== action.id) : [...state.conflictSelected, action.id];
      return { ...state, conflictSelected };
    }
    if (action.type === "conflictSelectAll") {
      const all = state.conflicts.map((conflict) => conflict.id);
      const allOn = all.length > 0 && all.every((id) => state.conflictSelected.includes(id));
      return { ...state, conflictSelected: allOn ? [] : all };
    }
    if (action.type === "conflictAction") return { ...state, conflictAction: action.action ?? "overwrite" };
    if (action.type === "conflictResolved") {
      const done = new Set(action.ids ?? []);
      return {
        ...state,
        conflicts: state.conflicts.filter((conflict) => !done.has(conflict.id)),
        conflictSelected: state.conflictSelected.filter((id) => !done.has(id))
      };
    }
    if (action.type === "resolvingConflicts") return { ...state, resolvingConflicts: Boolean(action.value) };
    return state;
  }
  function visibleRows(state) {
    const searched = filterRefs(state.refs, state.query);
    const shown = state.showArchived ? searched : searched.filter((ref) => !ref.archived);
    return sortRefs(shown, state.sortKey, state.sortAsc);
  }
  function filterRefs(refs, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return refs;
    return refs.filter((ref) => [ref.title, ref.authors, ref.doi, ref.url].some(
      (field) => typeof field === "string" && field.toLowerCase().includes(needle)
    ));
  }
  function sortRefs(refs, key, asc) {
    const byKey = {
      title: (ref) => String(ref.title ?? "").toLowerCase(),
      authors: (ref) => String(ref.authors ?? "").toLowerCase(),
      year: (ref) => {
        const year = Number(ref.year);
        return ref.year === "" || ref.year == null || !Number.isFinite(year) ? Number.POSITIVE_INFINITY : year;
      }
    }[key] ?? ((ref) => String(ref.title ?? "").toLowerCase());
    const valued = refs.filter((ref) => byKey(ref) !== Number.POSITIVE_INFINITY);
    const missing = refs.filter((ref) => byKey(ref) === Number.POSITIVE_INFINITY);
    const sorted = valued.sort((left, right) => {
      const a = byKey(left);
      const b = byKey(right);
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b));
    });
    return asc ? [...sorted, ...missing] : [...sorted.reverse(), ...missing];
  }
  function viewModel(state) {
    const rows = visibleRows(state);
    const preview = state.refs.find((ref) => ref.id === state.previewId) ?? null;
    const canSave = state.selected.length > 0 && state.collectionId.length > 0 && !state.saving;
    const archivedCount = state.refs.filter((ref) => ref.archived).length;
    return {
      rows,
      preview,
      allSelected: rows.length > 0 && rows.every((ref) => state.selected.includes(ref.id)),
      canSave,
      saveHint: saveHint(state, canSave),
      archivedCount
    };
  }
  function metaBadgeAction(ref) {
    if (ref.resolved) return "refresh";
    if (ref.proposal) return null;
    if (ref.doi || ref.arxiv) return "refresh";
    if (ref.canPropose) return "propose";
    return null;
  }
  function saveHint(state, canSave) {
    if (canSave) return "";
    if (state.saving) return "正在写入…";
    if (state.selected.length === 0) return "先勾选要写入的文献";
    if (state.collections.length === 0) return "读不到 Zotero 分类；确认桌面端 Zotero 开着";
    if (state.collectionId.length === 0) return "再选一个已有的分类";
    return "";
  }

  // src/ui.js
  var STYLE_ID = "dsh-refs2zotero-style";
  var CSS = `
.zr-root { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); }
.zr-head { flex: none; display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.zr-search { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); }
.zr-search:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
.zr-scroll { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
.zr-band { box-sizing: border-box; position: sticky; top: 0; z-index: 2; flex: none; display: flex; align-items: center; gap: 6px; width: 100%; height: 28px; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); font: var(--dsw-font-xxs-strong-12); color: var(--dsw-alias-label-secondary); }
.zr-bandLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zr-bandCount { flex: none; font: var(--dsw-font-xxxs-11); font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary); }
.zr-bandAction { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; flex: none; }
.zr-list { display: flex; flex-direction: column; padding: 2px 6px 8px; }
.zr-item { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 6px 8px 7px 10px; border-radius: 4px; cursor: pointer; animation: dsh-row-in 150ms var(--ds-ease-in-out); }
.zr-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.zr-item:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
.zr-item[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
.zr-item[data-selected='true']::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px; border-radius: 1px; background: var(--dsw-alias-state-business-primary); }
/* Line 1 = checkbox + wrapped title; line 2 = meta + chips + actions. */
.zr-line1 { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
.zr-check { flex: none; margin-top: 2px; width: 14px; height: 14px; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }
.zr-title { flex: 1; min-width: 0; font: var(--dsw-font-xxs-strong-12); color: var(--dsw-alias-label-primary); line-height: 1.45; overflow-wrap: anywhere; }
.zr-meta { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); padding-left: 20px; }
.zr-metaText { min-width: 0; overflow-wrap: anywhere; }
.zr-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 120ms var(--ds-ease-in-out); }
.zr-item:hover .zr-actions, .zr-item:focus-within .zr-actions { opacity: 1; }
@media (hover: none) { .zr-actions { opacity: 1; } }
/* A status badge that doubles as an action: the resting label swaps for the
   action label on hover. */
.zr-badge { box-sizing: border-box; display: inline-flex; align-items: center; flex: none; height: 18px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: none; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap; }
button.zr-badge { cursor: pointer; }
button.zr-badge:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
button.zr-badge:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
button.zr-badge:disabled { opacity: 0.5; cursor: default; }
.zr-badgeHover { display: none; }
button.zr-badge:hover .zr-badgeRest { display: none; }
button.zr-badge:hover .zr-badgeHover { display: inline; }
.zr-badge[data-tone='business'] { color: var(--dsw-alias-state-business-primary); }
.zr-badge[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.zr-badge[data-tone='muted'] { color: var(--dsw-alias-label-tertiary); }
.zr-icon { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; padding: 0; border: none; border-radius: 3px; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.zr-icon:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.zr-icon:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
.zr-icon[data-active='true'] { color: var(--dsw-alias-state-business-primary); }
.zr-icon:disabled { opacity: 0.4; cursor: default; }
.zr-preview { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 2px 20px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; }
.zr-line { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); overflow-wrap: anywhere; }
.zr-field { display: flex; gap: 8px; min-width: 0; line-height: 1.5; }
.zr-key { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); }
.zr-fieldValue { min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); overflow-wrap: anywhere; }
.zr-abstract { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); line-height: 1.6; max-height: 168px; overflow-y: auto; }
.zr-abstractToggle { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: none; background: none; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-strong-11); cursor: pointer; }
.zr-abstractToggle:hover { color: var(--dsw-alias-label-primary); }
.zr-abstractToggle:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: 1px; }
.zr-proposal { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px dashed var(--dsw-alias-state-business-primary); border-radius: 4px; }
.zr-proposalHead { font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-state-business-primary); }
.zr-inlineActions { display: flex; align-items: center; gap: 6px; }
.zr-button { box-sizing: border-box; height: 24px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: none; color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11); cursor: pointer; }
.zr-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.zr-button:disabled { opacity: 0.5; cursor: default; }
.zr-notice { flex: none; padding: 4px 12px 0; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-tertiary); white-space: pre-wrap; }
.zr-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
/* Conflict resolution: rows already in the library, waiting for a decision. */
.zr-conflict { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.zr-conflictHead { display: flex; align-items: center; gap: 8px; }
.zr-conflictHead span { font: var(--dsw-font-xxs-strong-12); color: var(--dsw-alias-state-warn-primary); }
.zr-conflictHead .zr-button { margin-left: auto; }
.zr-conflictList { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; }
.zr-conflictRow { display: flex; align-items: flex-start; gap: 6px; padding: 4px 6px; border-radius: 4px; }
.zr-conflictRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.zr-conflictText { min-width: 0; }
.zr-conflictTitle { color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); overflow-wrap: anywhere; }
.zr-conflictExisting { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); overflow-wrap: anywhere; }
.zr-conflictActions { display: flex; align-items: center; gap: 6px; }
.zr-conflictActions .zr-control { flex: 1; height: 24px; }
.zr-empty { padding: 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
.zr-foot { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.zr-footRow { display: flex; align-items: center; gap: 6px; }
.zr-select { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); }
.zr-select:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
/* A compact control for the sort band. */
.zr-control { height: 22px; padding: 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); }
.zr-control:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
.zr-primary { box-sizing: border-box; flex: none; height: 28px; padding: 0 12px; border: none; border-radius: 3px; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); font: var(--dsw-font-xxs-strong-12); cursor: pointer; }
.zr-primary[data-disabled='true'] { opacity: 0.4; cursor: default; }
.zr-primary:disabled { opacity: 0.4; cursor: default; }
.zr-hint { min-width: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
/* The "you still need to pick this" flash: a warn ring that pulses twice. */
.zr-flash { animation: zr-flash 600ms var(--ds-ease-in-out) 2; }
@keyframes zr-flash { 0% { box-shadow: 0 0 0 2px var(--dsw-alias-state-warn-primary); } 70% { box-shadow: 0 0 0 2px var(--dsw-alias-state-warn-primary); } 100% { box-shadow: none; } }
@keyframes dsh-row-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .zr-item { animation: none; } .zr-flash { animation: none; } }
`;
  function ensureStyle(doc = typeof document === "undefined" ? void 0 : document) {
    if (!doc) return;
    if (doc.querySelector(`#${STYLE_ID}`)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head?.appendChild(style);
  }
  function createAtoms(React) {
    const { createElement: h } = React;
    const IconButton = (props) => h("button", {
      type: "button",
      className: "zr-icon",
      title: props.title,
      "aria-label": props.title,
      "data-active": props.active ? "true" : void 0,
      disabled: props.disabled,
      onClick: (event) => {
        event.stopPropagation();
        props.onClick?.();
      }
    }, props.children);
    const Badge = ({ rest, hover, tone, onClick, disabled }) => h(
      onClick ? "button" : "span",
      {
        className: "zr-badge",
        type: onClick ? "button" : void 0,
        "data-tone": tone,
        disabled: onClick ? disabled : void 0,
        onClick: onClick ? (event) => {
          event.stopPropagation();
          onClick();
        } : void 0
      },
      h("span", { className: "zr-badgeRest" }, rest),
      onClick ? h("span", { className: "zr-badgeHover" }, hover) : null
    );
    const Glyph = ({ paths, size = 14 }) => h("svg", {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true
    }, (Array.isArray(paths) ? paths : [paths]).map((d, index) => h("path", { key: index, d })));
    return { IconButton, Badge, Glyph };
  }
  var GLYPH = {
    chevron: "M6 4l4 4-4 4",
    chevronDown: "M4 6l4 4 4-4",
    chevronUp: "M4 10l4-4 4 4",
    download: "M8 2v8m0 0L5 7m3 3l3-3M3 13h10",
    close: "M4 4l8 8M12 4l-8 8",
    check: "M3.5 8.5l3 3 6-6",
    // A file box (archive). The lid line + handle.
    archive: "M3 5h10v9H3z M6 5V3h4v2 M7 8.5h2",
    // Same box with an up arrow: restore from archive.
    restore: "M3 5h10v9H3z M6 5V3h4v2 M8 8v2.5 M6.5 8.5L8 7l1.5 1.5",
    eye: ["M2 8s2.5-3.5 6-3.5S14 8 14 8s-2.5 3.5-6 3.5S2 8 2 8z", "M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"],
    // Two arcs chasing each other with arrowheads: refresh.
    refresh: ["M2 8a6 6 0 0 1 9.6-4.8", "M12 1v2.5H9.5", "M14 8a6 6 0 0 1-9.6 4.8", "M4 15v-2.5h2.5"],
    arrowUp: "M8 12V4m0 0L5 7m3-3l3 3",
    arrowDown: "M8 4v8m0 0l3-3m-3 3l-3-3"
  };

  // src/panel.js
  function createApply(React) {
    const { createElement: h, useEffect, useReducer, useState } = React;
    const { IconButton, Badge, Glyph } = createAtoms(React);
    ensureStyle();
    function Field(key, value) {
      return h(
        "div",
        { className: "zr-field" },
        h("span", { className: "zr-key" }, key),
        h("span", { className: "zr-fieldValue" }, value)
      );
    }
    function AbstractBlock({ text }) {
      const [open, setOpen] = useState(false);
      return h(
        "div",
        null,
        h(
          "button",
          {
            type: "button",
            className: "zr-abstractToggle",
            "aria-expanded": open,
            onClick: (event) => {
              event.stopPropagation();
              setOpen(!open);
            }
          },
          h("span", { className: "zr-key" }, "摘要"),
          h(Glyph, { paths: open ? GLYPH.chevronUp : GLYPH.chevronDown, size: 12 })
        ),
        open ? h("div", { className: "zr-abstract" }, text) : null
      );
    }
    function Panel({ sessionId, visible }) {
      const [state, dispatch] = useReducer(reduce, void 0, () => {
        const base = initialState();
        try {
          const saved = sessionStorage.getItem(collectionStorageKey(sessionId));
          if (saved) base.collectionId = saved;
        } catch {
        }
        return base;
      });
      useEffect(() => {
        if (!visible) return void 0;
        let stop = false;
        async function tick() {
          const listed = await post({ op: "list", sessionId });
          const cols = await post({ op: "collections" });
          if (stop) return;
          dispatch({
            type: "sync",
            ...listed.ok ? { refs: listed.refs } : {},
            ...cols.ok ? { collections: cols.collections } : {},
            error: !listed.ok ? listed.error : !cols.ok ? cols.error : ""
          });
        }
        void tick();
        const timer = setInterval(() => {
          void tick();
        }, 2e3);
        return () => {
          stop = true;
          clearInterval(timer);
        };
      }, [visible, sessionId]);
      useEffect(() => {
        try {
          if (state.collectionId) sessionStorage.setItem(collectionStorageKey(sessionId), state.collectionId);
        } catch {
        }
      }, [sessionId, state.collectionId]);
      const model = viewModel(state);
      async function onSave(ids) {
        if (ids.length === 0) return;
        dispatch({ type: "saving", value: true });
        dispatch({ type: "message", text: "" });
        const result = await post({ op: "save", sessionId, ids, collectionId: state.collectionId });
        dispatch({ type: "saving", value: false });
        if (!result.ok) {
          dispatch({ type: "message", text: result.error || "保存失败" });
          return;
        }
        const conflicts = result.conflicts ?? [];
        if (conflicts.length > 0) dispatch({ type: "conflicts", conflicts });
        const parts = [`已写入 ${result.saved?.length ?? 0} 条`];
        if (conflicts.length > 0) parts.push(`${conflicts.length} 条已在库里，请在下方选择处理方式`);
        for (const item of result.failed ?? []) parts.push(item.reason);
        for (const item of result.warnings ?? []) parts.push(item.reason);
        dispatch({ type: "message", text: parts.join("，") });
      }
      async function onResolveConflicts() {
        if (state.conflictSelected.length === 0) {
          dispatch({ type: "flash", rows: true });
          return;
        }
        dispatch({ type: "resolvingConflicts", value: true });
        dispatch({ type: "message", text: "" });
        const result = await post({
          op: "resolveConflicts",
          sessionId,
          collectionId: state.collectionId,
          action: state.conflictAction,
          ids: state.conflictSelected
        });
        dispatch({ type: "resolvingConflicts", value: false });
        if (!result.ok) {
          dispatch({ type: "message", text: result.error || "处理冲突失败" });
          return;
        }
        const results = result.results ?? [];
        const okCount = results.filter((item) => item.ok).length;
        dispatch({ type: "conflictResolved", ids: state.conflictSelected });
        dispatch({ type: "message", text: `已处理 ${okCount}/${results.length} 条冲突` });
      }
      async function onAddToLibrary(id) {
        if (!state.collectionId) {
          dispatch({ type: "flash", collection: true });
          return;
        }
        await onSave([id]);
      }
      async function onPropose(id) {
        dispatch({ type: "message", text: "正在让模型读这一行…" });
        const result = await post({ op: "propose", sessionId, id });
        dispatch({ type: "message", text: result.ok ? "模型给出了建议，采用后才会写进条目" : result.error || "模型补题录失败" });
      }
      async function onConfirm(id, accept) {
        const result = await post({ op: "confirm", sessionId, id, accept });
        dispatch({ type: "message", text: result.ok ? accept ? "已采用模型建议" : "已忽略模型建议" : result.error || "操作失败" });
      }
      async function onRefreshMeta(ref) {
        if (ref.doi || ref.arxiv) {
          dispatch({ type: "message", text: "正在重新抓取题录…" });
          const result = await post({ op: "refresh", sessionId, id: ref.id });
          dispatch({ type: "message", text: result.ok ? "题录已更新" : result.error || "更新失败" });
          return;
        }
        await onPropose(ref.id);
      }
      async function onRefreshSelected(ids) {
        if (ids.length === 0) return;
        dispatch({ type: "message", text: "正在重查题录…" });
        const result = await post({ op: "refresh", sessionId, ids });
        if (!result.ok) {
          dispatch({ type: "message", text: result.error || "更新失败" });
          return;
        }
        const results = result.results ?? [];
        const okCount = results.filter((item) => item.ok).length;
        dispatch({ type: "message", text: `已重查 ${okCount}/${results.length} 条题录` });
      }
      async function onFindPdf(ids) {
        if (ids.length === 0) return;
        dispatch({ type: "fetching", ids });
        dispatch({ type: "message", text: "正在找可下载的 PDF…" });
        const result = await post({ op: "fetchPdf", sessionId, ids });
        dispatch({ type: "fetching", ids: [] });
        if (!result.ok) {
          dispatch({ type: "message", text: result.error || "找 PDF 失败" });
          return;
        }
        const ok = (result.results ?? []).filter((item) => item.ok);
        const parts = [`找到 ${ok.length} 个 PDF`];
        for (const item of (result.results ?? []).filter((item2) => !item2.ok)) parts.push(item.error);
        dispatch({ type: "message", text: parts.join("，") });
      }
      async function onToggleArchived(id, currentlyArchived) {
        dispatch({ type: "setArchived", id, value: !currentlyArchived });
        const result = await post({ op: currentlyArchived ? "unarchive" : "archive", sessionId, id });
        if (!result.ok) {
          dispatch({ type: "setArchived", id, value: currentlyArchived });
          dispatch({ type: "message", text: result.error || "操作失败" });
        }
      }
      function onWriteClick() {
        if (model.canSave) {
          void onSave(state.selected);
          return;
        }
        if (state.selected.length === 0) dispatch({ type: "flash", rows: true });
        if (!state.collectionId) dispatch({ type: "flash", collection: true });
      }
      function renderItem(ref) {
        const selected = state.selected.includes(ref.id);
        const expanded = state.previewId === ref.id;
        const busy = state.fetching.includes(ref.id);
        const metaAction = metaBadgeAction(ref);
        const meta = [shortAuthors(ref.authors), ref.year, ref.publicationTitle].filter(Boolean);
        return h(
          "div",
          {
            key: ref.id,
            className: "zr-item",
            "data-selected": selected ? "true" : "false",
            role: "button",
            tabIndex: 0,
            "aria-pressed": selected,
            "aria-expanded": expanded,
            style: ref.archived ? { opacity: 0.55 } : void 0,
            onClick: () => dispatch({ type: "preview", id: ref.id }),
            onKeyDown: (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              dispatch({ type: "preview", id: ref.id });
            }
          },
          h(
            "div",
            { className: "zr-line1" },
            h("input", {
              type: "checkbox",
              className: "zr-check",
              "aria-label": `勾选 ${ref.title || "这条文献"}`,
              checked: selected,
              onClick: (event) => event.stopPropagation(),
              onChange: () => dispatch({ type: "toggle", id: ref.id })
            }),
            h("div", { className: "zr-title" }, ref.title || "(没有题名)")
          ),
          h(
            "div",
            { className: "zr-meta" },
            meta.length > 0 ? h("span", { className: "zr-metaText" }, meta.join(" · ")) : null,
            h(Badge, {
              rest: ref.inLibrary ? "已在库" : "未入库",
              hover: "加入库",
              tone: ref.inLibrary ? "muted" : void 0,
              onClick: ref.inLibrary ? void 0 : (() => {
                void onAddToLibrary(ref.id);
              })
            }),
            h(Badge, {
              rest: ref.hasPdf ? "已有PDF" : "暂无PDF",
              hover: ref.hasPdf ? "更新PDF" : "查找PDF",
              tone: ref.hasPdf ? "muted" : void 0,
              onClick: () => {
                void onFindPdf([ref.id]);
              },
              disabled: busy
            }),
            h(Badge, {
              rest: ref.resolved ? "已有元信息" : ref.proposal ? "待确认题录" : "暂无元信息",
              hover: ref.resolved ? "更新元信息" : "查找元信息",
              tone: ref.proposal ? "business" : ref.resolved ? "muted" : void 0,
              onClick: metaAction === "refresh" ? (() => {
                void onRefreshMeta(ref);
              }) : metaAction === "propose" ? (() => {
                void onPropose(ref.id);
              }) : void 0
            }),
            h(
              "span",
              { className: "zr-actions" },
              h(IconButton, {
                title: ref.archived ? "取消归档" : "归档（隐藏这一条）",
                active: ref.archived,
                onClick: () => {
                  void onToggleArchived(ref.id, Boolean(ref.archived));
                }
              }, h(Glyph, { paths: ref.archived ? GLYPH.restore : GLYPH.archive }))
            )
          ),
          expanded ? renderPreview(ref) : null
        );
      }
      function renderPreview(ref) {
        const identifier = ref.arxiv ? ["arXiv", ref.arxiv] : ref.doi ? ["DOI", ref.doi] : null;
        const venue = [ref.publicationTitle, ref.volume, ref.issue, ref.pages].filter(Boolean).join(" ");
        const status = [
          ref.hasPdf ? "有 PDF" : "没有 PDF",
          ref.hasHtml ? "有网页快照" : "",
          ref.inLibrary ? "已在库" : "",
          ref.resolved ? "题录已按规范记录补全" : ""
        ].filter(Boolean).join(" · ");
        return h(
          "div",
          { className: "zr-preview" },
          ref.authors ? Field("作者", ref.authors) : null,
          venue ? Field("期刊", venue) : null,
          ref.year ? Field("年份", ref.year) : null,
          identifier ? Field(identifier[0], identifier[1]) : null,
          ref.url ? Field("链接", ref.url) : null,
          status ? Field("状态", status) : null,
          ref.abstract ? h(AbstractBlock, { text: ref.abstract }) : null,
          ref.why ? Field("备注", ref.why) : null,
          ref.proposal ? h(
            "div",
            { className: "zr-proposal" },
            h("div", { className: "zr-proposalHead" }, "模型建议的题录（还没采用）"),
            h("div", { className: "zr-line" }, ref.proposal.title || "(没有题名)"),
            h(
              "div",
              { className: "zr-line" },
              [ref.proposal.authors, ref.proposal.year, ref.proposal.publicationTitle, ref.proposal.doi].filter(Boolean).join(" · ")
            ),
            h(
              "div",
              { className: "zr-inlineActions" },
              h("button", { type: "button", className: "zr-button", onClick: (event) => {
                event.stopPropagation();
                void onConfirm(ref.id, true);
              } }, "采用"),
              h("button", { type: "button", className: "zr-button", onClick: (event) => {
                event.stopPropagation();
                void onConfirm(ref.id, false);
              } }, "忽略")
            )
          ) : null
        );
      }
      function renderConflicts() {
        const allOn = state.conflicts.length > 0 && state.conflictSelected.length === state.conflicts.length;
        return h(
          "div",
          { className: "zr-conflict" },
          h(
            "div",
            { className: "zr-conflictHead" },
            h("span", null, `有 ${state.conflicts.length} 条文献已在库里`),
            h(
              "button",
              { type: "button", className: "zr-button", onClick: () => dispatch({ type: "conflictSelectAll" }) },
              allOn ? "取消全选" : "全选"
            )
          ),
          h(
            "div",
            { className: "zr-conflictList" },
            state.conflicts.map((conflict) => {
              const ref = state.refs.find((row) => row.id === conflict.id);
              const selected = state.conflictSelected.includes(conflict.id);
              return h(
                "div",
                { className: "zr-conflictRow", key: conflict.id },
                h("input", {
                  type: "checkbox",
                  className: "zr-check",
                  "aria-label": `处理 ${ref?.title || conflict.existingTitle || "这条文献"}`,
                  checked: selected,
                  onChange: () => dispatch({ type: "conflictSelect", id: conflict.id })
                }),
                h(
                  "div",
                  { className: "zr-conflictText" },
                  h("div", { className: "zr-conflictTitle" }, ref?.title || "(没有题名)"),
                  conflict.existingTitle ? h("div", { className: "zr-conflictExisting" }, `库里已有：${conflict.existingTitle}`) : null
                )
              );
            })
          ),
          h(
            "div",
            { className: "zr-conflictActions" },
            h(
              "select",
              {
                className: "zr-control",
                "aria-label": "冲突处理方式",
                value: state.conflictAction,
                onChange: (event) => dispatch({ type: "conflictAction", action: event.target.value })
              },
              h("option", { value: "overwrite" }, "覆盖库里的条目"),
              h("option", { value: "duplicate" }, "两者都要（新建一条）"),
              h("option", { value: "cancel" }, "取消（不写入这些）")
            ),
            h("button", {
              type: "button",
              className: "zr-primary",
              disabled: state.conflictSelected.length === 0 || state.resolvingConflicts,
              onClick: () => {
                void onResolveConflicts();
              }
            }, state.resolvingConflicts ? "处理中…" : "确认处理")
          )
        );
      }
      return h(
        "div",
        { className: "zr-root" },
        h(
          "div",
          { className: "zr-head" },
          h("input", {
            className: "zr-search",
            "aria-label": "搜索",
            placeholder: "搜索题名、作者、DOI",
            value: state.query,
            onChange: (event) => dispatch({ type: "query", query: event.target.value })
          }),
          h("button", {
            type: "button",
            className: "zr-button",
            onClick: () => dispatch({ type: "selectAll" })
          }, model.allSelected ? "取消全选" : "全选"),
          h(IconButton, {
            title: state.showArchived ? "隐藏已归档" : "显示已归档",
            active: state.showArchived,
            onClick: () => dispatch({ type: "toggleArchived" })
          }, h(Glyph, { paths: GLYPH.eye }))
        ),
        state.conflicts.length > 0 ? renderConflicts() : null,
        h(
          "div",
          { className: "zr-scroll" },
          h(
            "div",
            { className: "zr-band" },
            h(
              "select",
              {
                className: "zr-control",
                "aria-label": "排序",
                value: state.sortKey,
                onChange: (event) => dispatch({ type: "sort", key: event.target.value })
              },
              h("option", { value: "title" }, "按标题"),
              h("option", { value: "authors" }, "按作者"),
              h("option", { value: "year" }, "按年份")
            ),
            h(IconButton, {
              title: state.sortAsc ? "升序（点击切换为降序）" : "降序（点击切换为升序）",
              onClick: () => dispatch({ type: "order" })
            }, h(Glyph, { paths: state.sortAsc ? GLYPH.arrowUp : GLYPH.arrowDown })),
            h("span", { className: "zr-bandCount" }, `${model.rows.length}/${state.refs.length}`),
            state.selected.length > 0 ? h(
              "span",
              { className: "zr-bandAction" },
              h(IconButton, {
                title: `更新选中的 ${state.selected.length} 条的元信息`,
                onClick: () => {
                  void onRefreshSelected(state.selected);
                }
              }, h(Glyph, { paths: GLYPH.refresh })),
              h(IconButton, {
                title: `为选中的 ${state.selected.length} 条找 PDF`,
                onClick: () => {
                  void onFindPdf(state.selected);
                }
              }, h(Glyph, { paths: GLYPH.download }))
            ) : null
          ),
          model.rows.length === 0 ? h("div", { className: "zr-empty" }, state.refs.length === 0 ? "这一会话还没有读到文献" : "没有匹配的行") : h("div", {
            className: state.flash.rows ? "zr-list zr-flash" : "zr-list",
            key: `rows-${state.flash.rows}`
          }, model.rows.map(renderItem))
        ),
        state.notice ? h("div", { className: "zr-notice", "data-tone": "error" }, state.notice) : null,
        state.message ? h("div", { className: "zr-notice" }, state.message) : null,
        h(
          "div",
          { className: "zr-foot" },
          h(
            "div",
            { className: "zr-footRow" },
            h(
              "select",
              {
                className: state.flash.collection ? "zr-select zr-flash" : "zr-select",
                key: `coll-${state.flash.collection}`,
                "aria-label": "分类",
                value: state.collectionId,
                onChange: (event) => dispatch({ type: "collection", id: event.target.value })
              },
              h("option", { value: "" }, "选择已有分类"),
              ...state.collections.map((collection) => h(
                "option",
                { key: collection.id, value: collection.id },
                collection.path || collection.name
              ))
            ),
            h("button", {
              type: "button",
              className: "zr-primary",
              "data-disabled": model.canSave ? "false" : "true",
              "aria-disabled": !model.canSave,
              onClick: onWriteClick
            }, state.saving ? "写入中…" : "写入 Zotero")
          ),
          model.saveHint ? h("div", { className: "zr-hint" }, model.saveHint) : null
        )
      );
    }
    return {
      inject: ["betterSidebar"],
      apply(ctx) {
        if (!ctx.betterSidebar) return;
        ctx.effect(() => ctx.betterSidebar.registerTab({
          id: "dsh-refs2zotero:library",
          title: () => "参考文献",
          order: 60,
          single: true,
          icon: (size) => h(
            "svg",
            { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.4 },
            h("rect", { x: 3, y: 2, width: 10, height: 12, rx: 1 }),
            h("path", { d: "M6 2v12" })
          ),
          component: ({ scope, visible }) => h(Panel, { sessionId: scope.sessionId, visible })
        }));
      }
    };
  }
  function shortAuthors(authors) {
    const text = typeof authors === "string" ? authors.trim() : "";
    if (!text) return "";
    const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? `${parts[0]} 等` : text;
  }
  async function post(body) {
    try {
      const response = await fetch("/dsh-refs2zotero/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      return await response.json();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "请求失败" };
    }
  }

  // src/client-entry.js
  window.__ModuleLoader__.load({
    id: "dsh-refs2zotero",
    factory(require2) {
      const React = require2("react");
      return createApply(React);
    }
  });
})();
