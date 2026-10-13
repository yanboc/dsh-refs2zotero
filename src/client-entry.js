import { createApply } from './panel.js'

window.__ModuleLoader__.load({
  id: 'dsh-refs2zotero',
  factory(require) {
    const React = require('react')
    return createApply(React)
  },
})
