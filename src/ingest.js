import { collectFromMessage, collectRef } from './collect.js'

/**
 * @returns {Map<string, { name: string, arguments: unknown }>}
 */
export function createPending() {
  return new Map()
}

/**
 * Rebuild one session's list from that session's own event log.
 *
 * Rows live in memory for the life of one plugin instance, and the harness's
 * event log is the durable record of what the session actually did. Replaying it
 * means a plugin that is loaded (or reloaded) mid-session still lists what the
 * session already read, instead of starting from the moment it happened to be
 * mounted.
 *
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {Map<string, { name: string, arguments: unknown }>} pending
 * @param {{ id?: unknown, snapshotEvents?: () => Array<{ type?: string, data?: any }> }} session
 * @returns {Array<any>} the rows this replay restored
 */
export function seedSession(store, pending, session) {
  if (!session || typeof session.snapshotEvents !== 'function') return []
  const restored = []
  for (const event of session.snapshotEvents()) {
    const ref = onSessionEvent(store, pending, session, event)
    if (ref) restored.push(ref)
  }
  return restored
}

/**
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {Map<string, { name: string, arguments: unknown }>} pending
 * @param {{ id?: unknown }} session
 * @param {{ type?: string, data?: any }} event
 */
export function onSessionEvent(store, pending, session, event) {
  const sessionId = session?.id == null ? '' : String(session.id)
  if (!sessionId || !event) return
  if (event.type === 'tool/call') {
    const data = event.data ?? {}
    pending.set(`${sessionId}:${data.callId}`, { name: String(data.name ?? ''), arguments: data.arguments })
    return
  }
  if (event.type === 'user/message' || event.type === 'assistant/message') {
    // References named in the chat itself: the user mentioning a paper, or the
    // assistant citing one. The message sits under `data.message` with a
    // `content` that is a string or an array of blocks.
    const message = event.data?.message ?? event.data ?? {}
    const text = textOf(message)
    if (text) {
      for (const ref of collectFromMessage(text)) {
        store.upsert(sessionId, ref)
      }
    }
    return
  }
  if (event.type !== 'tool/result') return
  const message = event.data?.message ?? {}
  const callId = callIdOf(message)
  if (!callId) return
  const key = `${sessionId}:${callId}`
  const call = pending.get(key)
  pending.delete(key)
  if (!call) return
  if (message.isError || event.data?.error) return null
  const ref = collectRef(call.name, parseArgs(call.arguments), textOf(message))
  return ref ? store.upsert(sessionId, ref) : null
}

/**
 * The harness stamps a tool-role message with `toolCallId` and repeats it on
 * `source.callId`. Older shapes used a bare `callId`; keep reading it so a
 * recorded log from either shape still pairs.
 * @param {Record<string, any>} message
 * @returns {string}
 */
export function callIdOf(message) {
  const direct = message?.toolCallId ?? message?.callId
  if (typeof direct === 'string' && direct.length > 0) return direct
  const source = message?.source?.callId
  return typeof source === 'string' ? source : ''
}

/**
 * @param {unknown} value
 */
export function parseArgs(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (value && typeof value === 'object') return /** @type {Record<string, unknown>} */ (value)
  return {}
}

/**
 * @param {{ content?: unknown }} message
 */
export function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n')
}
