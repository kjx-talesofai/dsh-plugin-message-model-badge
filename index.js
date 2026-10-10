/**
 * Message Model Badge — host half.
 *
 * The model that produced an assistant message is already in the log: every
 * `assistant/message` carries `message.source = { kind: 'model', provider,
 * model }` beside the `id` the browser receives as its `messageId`. No
 * client-visible session projection carries a per-message model —
 * `modelSelection` is per session (`{ lastUsed, next }`) — and the house rule is
 * that the Client does not fold session events itself.
 *
 * So this half does what DSH asks for in that situation: it declares a session
 * projection, folds the two fields into `messageId -> provider/model`, and lets
 * `wire.view` carry the result to the browser already computed. The browser half
 * only renders it.
 *
 * It is additive by construction. It appends no session event (a plugin-owned
 * event type would stop the session reopening), rewrites nobody's state, and
 * registers no route: one projection unit on this plugin's own fiber, removed
 * when the plugin unloads.
 *
 * Where the badge can appear: the host renders
 * `conversation.chat.assistant-actions` from exactly one place — the Turn tail,
 * keyed by the turn's *closing* assistant message. This projection indexes every
 * message, but the browser can only ever show one badge per turn. See the README.
 *
 * @module dsh-plugin-message-model-badge
 */

/** Stable Cordis plugin name (also the profile entry id). */
export const name = 'message-model-badge'

/** The projection registry is the only service this half needs. */
export const inject = ['sessionProjections']

/** Projection key the browser half reads through `useProjection`. */
export const PROJECTION_KEY = 'messageModel'

/**
 * How many recent messages carry an explicit entry in the wire value.
 *
 * The wire value is re-sent whole on every change, so an unbounded map would
 * grow without limit — real sessions here reach several thousand assistant
 * messages, which would mean hundreds of kilobytes pushed per message. Messages
 * outside this window fall back to `single`, which is exact for a session that
 * has only ever used one model.
 *
 * Fixed for 0.1.0; making it tunable would mean a `Config` and a schema
 * dependency.
 */
export const DEFAULT_WINDOW = 300

/**
 * Clone one state value.
 *
 * The registry hands a unit's state straight back out on the restore path
 * (`restore` seeds `refreshed[key].val` from parsed state and `hydrate` installs
 * that as the live cell) and to carriers through `snapshot()`. Cloning here keeps
 * a persisted row, or a carrier, from ever aliasing the live cell.
 *
 * @param value - a state value.
 * @returns a detached copy.
 */
function cloneState(value) {
  return { models: { ...value.models }, single: value.single, mixed: value.mixed }
}

/**
 * Schema for the unit's state, which is also its wire view (see `wire` below).
 *
 * The registry's only reach into a schema is `.parse` (six call sites in
 * `dsh-session-projection/lib/index.js`; nothing calls `safeParse`), so this is a
 * shape check rather than a validator import — the plugin carries no
 * dependencies. It has to be a real check, not a passthrough: `viewCheckpoint`
 * drops a key whose `parse` throws, which is what keeps a row persisted by an
 * older or corrupt build from being served as current.
 */
const stateSchema = {
  parse: (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('messageModel state must be an object')
    }
    if (value.models === null || typeof value.models !== 'object' || Array.isArray(value.models)) {
      throw new TypeError('messageModel state.models must be a plain object')
    }
    return cloneState(value)
  },
}

/**
 * Build the `messageModel` projection unit.
 *
 * State (and therefore the wire value) is:
 *
 * - `models` — `messageId -> "provider/model"` for the most recent `window`
 *   messages.
 * - `single` — that same label while the Session has used exactly one model,
 *   otherwise `null`. This is what keeps an old message in a long single-model
 *   Session labelled after it falls out of the window.
 * - `mixed` — whether more than one model has been seen. Once true it stays true,
 *   so `single` can never be resurrected by a later coincidental match.
 *
 * @param limit - recent messages to keep explicitly addressable.
 * @returns a `ProjectionDefinition` for `ctx.sessionProjections.register`.
 */
export function createDefinition(limit = DEFAULT_WINDOW) {
  const window = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : DEFAULT_WINDOW
  return {
    key: PROJECTION_KEY,
    // Bump when the state fields or the fold semantics change.
    stateVersion: 1,
    stateSchema,
    init: () => ({ models: {}, single: null, mixed: false }),
    /**
     * Fold one committed Session event.
     * @param state - current state; returned unchanged for unrelated events.
     * @param event - the committed event.
     * @returns the next state, or the same reference.
     */
    apply: (state, event) => {
      // Every committed event reaches every unit; returning `state` untouched
      // keeps the registry from re-computing a view or notifying carriers for the
      // events this unit does not track.
      if (event.type !== 'assistant/message') return state
      const message = event.data?.message
      const source = message?.source
      const id = message?.id
      if (typeof id !== 'string' || source?.kind !== 'model') return state
      if (typeof source.provider !== 'string' || typeof source.model !== 'string') return state

      const label = `${source.provider}/${source.model}`
      if (state.models[id] === label) return state

      // Message ids are UUIDs, so `Object.keys` insertion order is arrival order
      // and the eviction below drops the oldest first.
      const models = { ...state.models, [id]: label }
      const ids = Object.keys(models)
      for (let index = 0; index < ids.length - window; index += 1) delete models[ids[index]]

      // `single` survives only while every message so far agrees.
      const mixed = state.mixed || (state.single !== null && state.single !== label)
      return { models, mixed, single: mixed ? null : label }
    },
    wire: {
      viewSchema: stateSchema,
      // Identity-stable by construction: the state IS the view, so consecutive
      // views compare equal and the registry suppresses publication whenever
      // nothing changed. `viewSchema.parse` detaches the copy carriers receive.
      view: (state) => state,
    },
  }
}

/**
 * Register the projection.
 *
 * There is deliberately no `Config`: the only tunable would be the window, and a
 * schema dependency is not worth carrying for it (the default covers a
 * single-model Session of any length via `single`). `createDefinition` takes the
 * limit explicitly for tests.
 *
 * @param ctx - host context carrying `sessionProjections`.
 */
export function apply(ctx) {
  // Registration is an effect on this fiber: unloading the plugin removes the key
  // and its cached cells.
  ctx.sessionProjections.register(createDefinition(DEFAULT_WINDOW))
}
