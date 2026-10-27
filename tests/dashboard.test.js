import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { Window } from 'happy-dom'

const browser = new Window({ url: 'http://localhost:5173' })
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'Element',
  'HTMLElement',
  'SVGElement',
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? browser : browser[key],
  })
Object.defineProperty(document, 'hidden', { configurable: true, value: false })
Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: {
    watchPosition(success) {
      queueMicrotask(() =>
        success({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 100 } }),
      )
      return 1
    },
    clearWatch() {},
  },
})
Object.defineProperty(navigator, 'permissions', {
  configurable: true,
  value: { query: async () => ({ state: 'granted', onchange: null }) },
})
Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
const { createApp, nextTick } = await import('vue')
const file = new URL('../.data/dashboard-test.mjs', import.meta.url)
const root = new URL('../', import.meta.url)
const { descriptor } = parse(await readFile(new URL('../pages/index.vue', import.meta.url), 'utf8'))
let compiled = compileScript(descriptor, { id: 'dashboard-test', inlineTemplate: true }).content
compiled = compiled
  .replace(
    /import PlanearbyAircraftIcon from [^\n]+/,
    'const PlanearbyAircraftIcon = { render: () => null }',
  )
  .replace(
    /import PlanearbySplitFlap from [^\n]+/,
    "const PlanearbySplitFlap = { props: ['text'], render() { return testH('span', String(this.text)) } }",
  )
  .replace(/from ['"]~\/([^'"]+)['"]/g, (_, path) => `from '${new URL(path, root).href}'`)
await mkdir(new URL('../.data/', import.meta.url), { recursive: true })
await writeFile(file, `import { h as testH } from 'vue'\n${compiled}`)
const { default: Dashboard } = await import(file.href)
after(async () => {
  await rm(file, { force: true })
  await browser.happyDOM.abort()
})

const flush = async () => {
  await new Promise(setImmediate)
  await nextTick()
}
const positionResponse = () =>
  Response.json({
    now: Date.now(),
    ac: [{ hex: 'abc123', flight: 'KAL1428', t: 'B738', lat: 37.5675, lon: 126.978, track: 5 }],
  })

test('the dashboard keeps polling past 30 seconds and a manual stop cancels further requests', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 27) })
  let positions = 0
  let signal
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('/api/aircraft')) {
      positions += 1
      signal = options.signal
      return positionResponse()
    }
    return Response.json({ response: { flightroute: { callsign_icao: 'KAL1428' } } })
  }
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.equal(positions, 1)
    for (let i = 0; i < 7; i += 1) {
      t.mock.timers.tick(5000)
      await flush()
    }
    assert.equal(positions, 8)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new window.Event('visibilitychange'))
    t.mock.timers.tick(5000)
    await flush()
    assert.equal(positions, 9, 'background visibility must not stop the continuous scan')
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new window.Event('visibilitychange'))
    await flush()
    assert.equal(positions, 9, 'visibility changes must not exceed the five-second request rate')
    assert.match(target.querySelector('.scan-button').textContent, /조회 중지/)
    assert.equal(target.querySelector('.split-flap--callsign').textContent, 'KAL 1428')
    assert.equal(target.querySelectorAll('.board-route .split-flap--airport').length, 2)
    assert.equal(target.querySelectorAll('.board-route .split-flap--airport')[0].textContent, 'NON')
    assert.match(target.querySelector('.flight-board__note').textContent, /참고 노선/)
    assert.equal(target.querySelector('.board-route__time'), null)
    assert.equal(target.querySelector('.scan-message'), null)
    target.querySelector('.scan-button').click()
    await flush()
    t.mock.timers.tick(10000)
    await flush()
    assert.equal(positions, 9)
    assert.equal(signal.aborted, true)
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})

test('a provider limit keeps automatic polling active and waits before trying again', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 27) })
  let positions = 0
  globalThis.fetch = async (url) => {
    if (!url.startsWith('/api/aircraft')) return new Response(null, { status: 404 })
    positions += 1
    return positions === 1
      ? new Response(null, { status: 429, headers: { 'Retry-After': '15' } })
      : positionResponse()
  }
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.match(target.querySelector('.header__status').textContent, /재연결/)
    for (let i = 0; i < 2; i += 1) {
      t.mock.timers.tick(5000)
      await flush()
    }
    assert.equal(positions, 1)
    t.mock.timers.tick(5000)
    await flush()
    assert.equal(positions, 2)
    assert.match(target.querySelector('.header__status').textContent, /조회 중/)
    assert.ok(
      target.querySelector('.flight-board__note'),
      'the notice stays mounted when there is no text',
    )
    assert.equal(target.querySelector('.flight-board__note').textContent.trim(), '')
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})

test('an unconfigured static API stops polling and explains the required connection', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 27) })
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(null, { status: 404 })
  }
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.match(target.querySelector('.fids-empty').textContent, /중계 API가 연결되지/)
    assert.match(target.querySelector('.scan-button').textContent, /다시 조회/)
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(requests, 1)
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})
