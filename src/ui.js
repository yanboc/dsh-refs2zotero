/**
 * Client-side chrome for the 参考文献 page.
 *
 * The panel has to look like the sidebar it lives in, so this sheet uses only
 * the app's design tokens (`--dsw-alias-*`, the `--dsw-font-*` scale) and copies
 * the changes tab's metrics: a 36px header band, 28px controls, 22px chips,
 * 4px radii, rows that reveal their actions on hover, and the 2px accent marker
 * for a selected row.
 *
 * The bundle is plain JS with no CSS pipeline, so the sheet is injected once
 * from here.
 */
export const STYLE_ID = 'dsh-refs2zotero-style'

export const CSS = `
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
.zr-title { font: var(--dsw-font-xxs-strong-12); color: var(--dsw-alias-label-primary); line-height: 1.45; overflow-wrap: anywhere; }
.zr-meta { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.zr-metaText { min-width: 0; overflow-wrap: anywhere; }
.zr-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 120ms var(--ds-ease-in-out); }
.zr-item:hover .zr-actions, .zr-item:focus-within .zr-actions { opacity: 1; }
@media (hover: none) { .zr-actions { opacity: 1; } }
.zr-chip { box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; flex: none; height: 18px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap; }
.zr-chip[data-tone='business'] { color: var(--dsw-alias-state-business-primary); }
.zr-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.zr-chip[data-tone='muted'] { color: var(--dsw-alias-label-tertiary); }
.zr-icon { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; padding: 0; border: none; border-radius: 3px; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.zr-icon:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.zr-icon:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
.zr-icon[data-danger='true']:hover { color: var(--dsw-alias-state-error-primary); }
.zr-icon:disabled { opacity: 0.4; cursor: default; }
.zr-preview { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 2px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; }
.zr-line { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); overflow-wrap: anywhere; }
.zr-abstract { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); line-height: 1.6; max-height: 168px; overflow-y: auto; }
.zr-proposal { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px dashed var(--dsw-alias-state-business-primary); border-radius: 4px; }
.zr-proposalHead { font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-state-business-primary); }
.zr-inlineActions { display: flex; align-items: center; gap: 6px; }
.zr-button { box-sizing: border-box; height: 24px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: none; color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11); cursor: pointer; }
.zr-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.zr-button:disabled { opacity: 0.5; cursor: default; }
.zr-notice { flex: none; padding: 4px 12px 0; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-tertiary); white-space: pre-wrap; }
.zr-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.zr-empty { padding: 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
.zr-foot { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.zr-footRow { display: flex; align-items: center; gap: 6px; }
.zr-select { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); }
.zr-select:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }
.zr-primary { box-sizing: border-box; flex: none; height: 28px; padding: 0 12px; border: none; border-radius: 3px; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); font: var(--dsw-font-xxs-strong-12); cursor: pointer; }
.zr-primary:disabled { opacity: 0.4; cursor: default; }
.zr-hint { min-width: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
@keyframes dsh-row-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .zr-item { animation: none; } }
`

/**
 * Install the sheet once per document.
 * @param {{ head?: { querySelector: (s: string) => unknown, appendChild: (n: any) => void }, createElement: (t: string) => any }} [doc]
 */
export function ensureStyle(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc) return
  if (doc.querySelector(`#${STYLE_ID}`)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head?.appendChild(style)
}

/**
 * @param {typeof import('react')} React
 */
export function createAtoms(React) {
  const { createElement: h } = React

  const IconButton = props => h('button', {
    type: 'button',
    className: 'zr-icon',
    title: props.title,
    'aria-label': props.title,
    'data-danger': props.danger ? 'true' : undefined,
    disabled: props.disabled,
    onClick: event => {
      event.stopPropagation()
      props.onClick?.()
    },
  }, props.children)

  const Chip = ({ tone, children }) => h('span', { className: 'zr-chip', 'data-tone': tone }, children)

  /** Two-line glyphs, 14px, matching the sidebar's own icon weight. */
  const Glyph = ({ path, size = 14 }) => h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, h('path', { d: path }))

  return { IconButton, Chip, Glyph }
}

export const GLYPH = {
  chevron: 'M6 4l4 4-4 4',
  download: 'M8 2v8m0 0L5 7m3 3l3-3M3 13h10',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-6',
}

