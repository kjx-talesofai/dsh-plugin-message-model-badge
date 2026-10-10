/**
 * Contract test for dsh-plugin-message-model-badge.
 *
 * The load-bearing half is the projection fold, so it is driven directly and
 * hard; the browser half is exercised through the module-loader shape it ships
 * in (a captured `window.__ModuleLoader__.load` call, not the harness's own
 * loader).
 *
 *   Proven here
 *   - the fold ignores every event it does not own **by returning the same state
 *     reference**; a fresh object per event would make the registry recompute a
 *     view and notify carriers for the whole log, and is asserted against.
 *   - it records `messageId -> provider/model` from a real-shaped
 *     `assistant/message`, is idempotent on replay, and skips a source that is not
 *     a model, a message with no usable id, `assistant/attempt` (which carries no
 *     message), and the `interrupted` variant of the same event.
 *   - `single` tracks the one-model case, drops to null as soon as a second model
 *     appears, and cannot be resurrected by a later match.
 *   - the window bounds the wire value, drops the oldest ids first, and cannot be
 *     defeated by a limit that is not a usable count.
 *   - the schema rejects a malformed value (which is what makes `viewCheckpoint`
 *     drop a bad persisted row) and detaches what it returns.
 *   - `apply` registers exactly one unit, under the key the browser reads.
 *   - `client.js` runs as a plain script against a `window.__ModuleLoader__`
 *     facade, registers one entry in the assistant action strip and returns a
 *     disposer, and renders the projected label — including the four cases where
 *     it must render nothing.
 *
 *   NOT proven here
 *   - the harness end: that the registry drives the unit, that the projection
 *     reaches a real browser, and how the label looks in the row. See the README.
 *
 * Run with `npm test`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const clientSource = readFileSync(join(root, 'client.js'), 'utf8')

const NS = pkg.name
const REPO = 'kjx-talesofai/dsh-plugin-message-model-badge'
const SLOT = 'conversation.chat.assistant-actions'

const host = await import(join(root, 'index.js'))
const { PROJECTION_KEY, DEFAULT_WINDOW, createDefinition, apply: hostApply } = host

/**
 * One `assistant/message` shaped like the committed event: `SessionEventMap`
 * declares `{ turn, step, message, stream, usage?, interrupted? }`, and
 * `message.source` is the `ModelMessageSource` this plugin reads.
 * @param id - the message id the browser receives as `messageId`.
 * @param provider - provider id, or null for a non-model source.
 * @param model - model id.
 * @param extra - extra `data` fields (e.g. `interrupted`).
 */
function messageEvent(id, provider, model, extra = {}) {
  return {
    type: 'assistant/message',
    seq: 1,
    time: 0,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'pong' }],
        ...(provider === null ? { source: { kind: 'synthetic' } } : { source: { kind: 'model', provider, model } }),
        ...(id === undefined ? {} : { id }),
      },
      stream: [],
      usage: {},
      ...extra,
    },
  }
}

/** Fold a sequence of events, returning the final state. */
function fold(events, definition = createDefinition()) {
  return events.reduce((state, event) => definition.apply(state, event), definition.init())
}

test('the host half exports an apply function and a projection definition', () => {
  assert.equal(typeof hostApply, 'function')
  assert.equal(typeof createDefinition, 'function')
  assert.equal(PROJECTION_KEY, 'messageModel')
  assert.equal(DEFAULT_WINDOW, 300)
})

test('unrelated events keep the very same state reference', () => {
  const definition = createDefinition()
  const start = definition.init()

  for (const event of [
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 0, data: { turn: 1, step: 1 } },
    { type: 'user/message', seq: 3, time: 0, data: {} },
    { type: 'tool/call', seq: 4, time: 0, data: {} },
    { type: 'request/header', seq: 5, time: 0, data: { header: { config: { provider: 'a', model: 'b' } } } },
    // A retry attempt carries only the stream — no message, no source.
    { type: 'assistant/attempt', seq: 6, time: 0, data: { turn: 1, step: 1, stream: [] } },
  ]) {
    // Identity, not deep equality: an allocation here is what would make the
    // registry recompute a view and notify carriers for this event.
    assert.equal(definition.apply(start, event), start, `${event.type} must not allocate`)
  }
})

test('a model message is recorded under the id the browser gets', () => {
  const state = fold([messageEvent('m-1', 'deepseek-official', 'deepseek-flash')])
  assert.deepEqual(state.models, { 'm-1': 'deepseek-official/deepseek-flash' })
  assert.equal(state.single, 'deepseek-official/deepseek-flash')
  assert.equal(state.mixed, false)
})

test('an interrupted message still carries its id and source', () => {
  // `interrupted: true` marks how the message settled, not a different shape: it
  // is a real AssistantMessage, so it must be recorded like any other.
  const state = fold([messageEvent('m-1', 'bailian', 'qwen3.5-27b', { interrupted: true })])
  assert.deepEqual(state.models, { 'm-1': 'bailian/qwen3.5-27b' })
})

test('replaying the same message is idempotent and free', () => {
  const definition = createDefinition()
  const first = definition.apply(definition.init(), messageEvent('m-1', 'p', 'm'))
  assert.equal(definition.apply(first, messageEvent('m-1', 'p', 'm')), first)
})

test('a source that is not a model, or an unusable id, is skipped', () => {
  const definition = createDefinition()
  const state = definition.init()
  for (const event of [
    messageEvent('m-1', null, 'm'),
    messageEvent(undefined, 'p', 'm'),
    messageEvent('m-2', 'p', undefined),
    { type: 'assistant/message', seq: 1, time: 0, data: {} },
    { type: 'assistant/message', seq: 1, time: 0 },
  ]) {
    assert.equal(definition.apply(state, event), state, JSON.stringify(event.data) + ' must be ignored')
  }
})

test('single survives one model and is retired by a second', () => {
  const definition = createDefinition()
  let state = definition.init()
  state = definition.apply(state, messageEvent('m-1', 'a', 'one'))
  state = definition.apply(state, messageEvent('m-2', 'a', 'one'))
  assert.equal(state.single, 'a/one', 'one model so far')
  assert.equal(state.mixed, false)

  state = definition.apply(state, messageEvent('m-3', 'b', 'two'))
  assert.equal(state.single, null, 'a second model retires the fallback')
  assert.equal(state.mixed, true)

  // Back to the first model: the fallback must NOT come back, because a message
  // older than the window could then be labelled with the wrong model.
  state = definition.apply(state, messageEvent('m-4', 'a', 'one'))
  assert.equal(state.single, null, 'mixed is permanent')
  assert.equal(state.models['m-4'], 'a/one')
})

test('the window bounds the wire value, oldest first', () => {
  const definition = createDefinition(3)
  let state = definition.init()
  for (let index = 0; index < 5; index += 1) state = definition.apply(state, messageEvent(`m-${index}`, 'p', 'm'))

  assert.deepEqual(Object.keys(state.models), ['m-2', 'm-3', 'm-4'])
  // The single-model fallback still covers the dropped ones exactly.
  assert.equal(state.single, 'p/m')
})

test('a limit that is not a usable count falls back to the default', () => {
  for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5, 'x', undefined]) {
    const definition = createDefinition(limit)
    assert.equal(definition.key, PROJECTION_KEY)
    const events = Array.from({ length: DEFAULT_WINDOW + 10 }, (_, index) => messageEvent(`m-${index}`, 'p', 'm'))
    // The regression this guards: `Math.max(1, NaN)` is NaN, so the eviction loop
    // would never run and the map would grow without bound.
    assert.equal(Object.keys(fold(events, definition).models).length, DEFAULT_WINDOW, String(limit))
  }
})

test('the schema rejects a malformed value and detaches what it returns', () => {
  const definition = createDefinition()

  // `viewCheckpoint` drops a key whose `parse` throws — that is what stops a row
  // persisted by an older or corrupt build from being served as current.
  for (const bad of [null, undefined, 'x', 42, [], {}, { models: null }, { models: [] }, { models: 'x' }]) {
    assert.throws(() => definition.stateSchema.parse(bad), TypeError, JSON.stringify(bad))
  }

  const stored = { models: { 'm-1': 'p/m' }, single: 'p/m', mixed: false }
  const parsed = definition.stateSchema.parse(stored)
  assert.deepEqual(parsed, stored)
  assert.notEqual(parsed, stored, 'a persisted row must not alias the live cell')
  assert.notEqual(parsed.models, stored.models)
})

test('the raw view is the state object itself', () => {
  const definition = createDefinition()
  const state = definition.apply(definition.init(), messageEvent('m-1', 'p', 'm'))
  // Identity-stable, so consecutive views compare equal at the registry's gate.
  assert.equal(definition.wire.view(state), state)
  assert.equal(definition.stateVersion, 1)
})

test('apply registers exactly one unit, under the key the browser reads, at the default window', () => {
  const registered = []
  hostApply({ sessionProjections: { register: (definition) => registered.push(definition) } })

  assert.equal(registered.length, 1)
  assert.equal(registered[0].key, PROJECTION_KEY)
  assert.equal(registered[0].stateVersion, 1)

  const events = Array.from({ length: DEFAULT_WINDOW + 5 }, (_, index) => messageEvent(`m-${index}`, 'p', 'm'))
  assert.equal(Object.keys(fold(events, registered[0]).models).length, DEFAULT_WINDOW)
})

//#region browser half

/** A React stand-in that keeps the conventions this component relies on. */
function fakeReact() {
  return {
    createElement: (type, props, ...children) => {
      const { key, ...rest } = props ?? {}
      const nested = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: { ...rest, children: nested }, key: key ?? null }
    },
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

/** Execute `client.js` as a script and materialize the module it registers. */
function loadClient() {
  const loaded = []
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    navigator: {},
    document: { body: { appendChild() {} } },
    window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } },
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })

  assert.equal(loaded.length, 1, 'client.js must register exactly one module')
  const [entry] = loaded
  assert.equal(entry.id, NS, 'the registered module id must be the package name')
  return entry.factory((specifier) => {
    if (specifier === 'react') return fakeReact()
    throw new Error(`client.js required an unexpected module: ${specifier}`)
  })
}

/** Register the browser half against a recording context. */
function boot() {
  const registrations = []
  const effects = []
  const module = loadClient()
  module.apply({
    effect(factory) {
      effects.push(factory())
    },
    slots: {
      register(options, component) {
        registrations.push({ options, component })
        // The real registry returns a disposer that `slots.inject` collects.
        return () => {}
      },
      // `ui-renderer` wraps the callback in `ctx.effect(callback)`, so the
      // callback must hand back the registration's disposer — dropping it leaks
      // the entry across a hot re-apply.
      inject(key, callback) {
        const dispose = callback()
        assert.equal(typeof dispose, 'function', `slots.inject("${key}") must return a disposer`)
        effects.push(dispose)
      },
    },
  })
  return { module, registrations, effects }
}

/** Render the badge for one message against a given projection value. */
function renderBadge(component, messageId, projection) {
  return component({ messageId, useProjection: (key) => (key === PROJECTION_KEY ? projection : undefined) })
}

test('client.js requires nothing that could miss the loader table', () => {
  const requires = [...clientSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(requires)].sort(), ['react'])
  assert.match(clientSource, /window\.__ModuleLoader__\.load\(/)
})

test('the browser half registers one entry in the assistant action strip', () => {
  const { module, registrations, effects } = boot()
  assert.deepEqual([...module.inject], ['slots'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, SLOT)
  assert.equal(registrations[0].options.id, 'dsh-plugin-message-model-badge')
  assert.equal(registrations[0].options.order, 20)
  assert.equal(effects.length, 1, 'the one injection is disposer-backed')
})

test('the badge renders the projected label and nothing else', () => {
  const { registrations } = boot()
  const { component } = registrations[0]

  const windowed = renderBadge(component, 'm-1', { models: { 'm-1': 'bailian/qwen3.5-27b' }, single: null, mixed: true })
  assert.equal(windowed.type, 'span')
  assert.equal(windowed.props.children, 'bailian/qwen3.5-27b')
  assert.equal(windowed.props.title, 'bailian/qwen3.5-27b')
  // Copies the host row's own typography, in tokens only.
  assert.match(windowed.props.style.fontSize, /--dsh-content-font-size-secondary/)
  assert.match(windowed.props.style.color, /--dsw-alias-label-tertiary/)
  assert.equal(windowed.props.style.whiteSpace, 'nowrap')

  // Older than the window, in a Session that has only ever used one model.
  const older = renderBadge(component, 'm-ancient', { models: {}, single: 'deepseek-official/deepseek-flash', mixed: false })
  assert.equal(older.props.children, 'deepseek-official/deepseek-flash')
})

test('the badge renders nothing rather than guessing', () => {
  const { registrations } = boot()
  const { component } = registrations[0]

  for (const [why, projection] of [
    ['the projection has not arrived', undefined],
    ['nothing projected for this message', { models: {}, single: null, mixed: true }],
    ['a mixed Session outside the window', { models: { 'm-2': 'a/b' }, single: null, mixed: true }],
    ['an empty label', { models: { 'm-1': '' }, single: null, mixed: true }],
  ]) {
    assert.equal(renderBadge(component, 'm-1', projection), null, why)
  }
})

//#endregion

test('the manifest declares the bundle patch, the client half, and an icon', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['.'].default, './index.js')
  assert.equal(pkg.exports['./client'].default, './client.js')
  assert.equal(pkg.icon, './assets/icon.svg', 'the plugin card silently falls back without this')

  // The enforced compatibility gate reads peerDependencies, not dsh.engines.
  assert.match(pkg.peerDependencies['@deepseek-ai/dsh'], /^>=0\.2\.0-rc\.1 <0\.3\.0-0$/)
  assert.equal(pkg.private, undefined, 'a publishable package must not be private')
  assert.equal(pkg.dependencies, undefined, 'the host half imports nothing')

  // Public-facing identity: a stale URL here is green everywhere else.
  for (const [field, value] of [
    ['repository.url', pkg.repository.url],
    ['homepage', pkg.homepage],
    ['bugs.url', pkg.bugs.url],
  ]) {
    assert.ok(value.includes(REPO), field)
  }

  // The runtime entries of `files`; the tarball's own contents are asserted in CI.
  assert.deepEqual(pkg.files, [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'assets/icon.svg',
    'locale/*.json',
    'README.md',
    'LICENSE',
  ])

  for (const relative of ['cordis.patch.yml', 'assets/icon.svg', 'index.js', 'client.js']) {
    readFileSync(join(root, relative))
  }
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(join(root, 'locale', `${language}.json`), 'utf8'))
    assert.equal(typeof meta.meta.title, 'string')
    assert.equal(typeof meta.meta.description, 'string')
  }

  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /^-\s+insert:/m, 'the patch inserts at least one row')
  assert.match(patch, new RegExp(`name:\\s*'?${pkg.name}'?`), 'the row mounts this package')
  assert.match(patch, /^\s*-\s*id:\s*message-model-badge\s*$/m, 'the row id is exact')
})
