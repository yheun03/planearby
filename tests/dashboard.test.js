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
  .replace(
    /import PlanearbyLocationPicker from [^\n]+/,
    `const PlanearbyLocationPicker = {
      props: ['initialLocation', 'language'], emits: ['select', 'close'],
      data() { return { opened: false } },
      methods: {
        open() { this.opened = true },
        close() { this.opened = false; this.$emit('close') },
      },
      render() {
        return this.opened ? testH('button', {
          class: 'test-location-apply',
          onClick: () => { this.close(); this.$emit('select', { lat: 35.1796, lon: 129.0756 }) },
        }, 'Apply test location') : null
      },
    }`,
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
    if (url.startsWith('https://proxy.cors.dev/')) {
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
    if (!url.startsWith('https://proxy.cors.dev/')) return new Response(null, { status: 404 })
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
    assert.equal(target.querySelector('.quota-dialog').open, false)
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

test('a static build starts live scanning and offers fictional examples only after an error', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 27) })
  const locationRequest = t.mock.method(navigator.geolocation, 'watchPosition')
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
    assert.equal(target.querySelectorAll('.radar-aircraft').length, 0)
    assert.match(target.querySelector('.scan-button').textContent, /다시 조회/)
    assert.ok(target.querySelector('.setting-group--location'))
    t.mock.timers.tick(30000)
    await flush()
    assert.equal(locationRequest.mock.callCount(), 1)
    assert.equal(requests, 1)

    target.querySelector('.fids-empty__preview').click()
    await flush()
    assert.equal(target.querySelectorAll('.radar-aircraft').length, 12)
    assert.match(target.querySelector('.header__status').textContent, /예시 데이터/)
    const first = target.querySelector('.split-flap--callsign').textContent
    t.mock.timers.tick(10000)
    await flush()
    assert.notEqual(target.querySelector('.split-flap--callsign').textContent, first)
    assert.equal(requests, 1)
    assert.equal(locationRequest.mock.callCount(), 1)
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})

test('daily exhaustion opens the full-screen dialog and stops requests until the reset', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 27) })
  let positions = 0
  let signal
  const locationRequest = t.mock.method(navigator.geolocation, 'watchPosition')
  globalThis.fetch = async (url, options) => {
    if (!url.startsWith('https://proxy.cors.dev/')) return new Response(null, { status: 404 })
    positions += 1
    signal = options.signal
    return positions === 2
      ? new Response(null, {
          status: 429,
          headers: {
            'X-RateLimit-Limit': '500, 4;w=1, 60;w=60, 500;w=86400',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': '3600',
          },
        })
      : positionResponse()
  }
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.equal(positions, 1)
    target.querySelector('.settings-fab').click()
    assert.equal(target.querySelector('.settings-dialog').open, true)
    t.mock.timers.tick(5000)
    await flush()
    const dialog = target.querySelector('.quota-dialog')
    assert.equal(dialog.open, true)
    assert.equal(target.querySelector('.settings-dialog').open, false)
    assert.match(dialog.textContent, /조회 토큰을 모두 사용/)
    assert.match(dialog.textContent, /일일 조회 한도/)
    assert.equal(target.querySelectorAll('.radar-aircraft').length, 0)
    assert.equal(signal.aborted, true)
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(positions, 2)
    target.querySelector('.quota-dialog__confirm').click()
    assert.equal(dialog.open, false)
    target.querySelector('.scan-button').click()
    await flush()
    assert.equal(dialog.open, true)
    assert.equal(positions, 2)
    assert.equal(locationRequest.mock.callCount(), 1)
    target.querySelector('.quota-dialog__confirm').click()
    t.mock.timers.tick(3600000)
    target.querySelector('.scan-button').click()
    await flush()
    assert.equal(positions, 3)
    assert.equal(locationRequest.mock.callCount(), 2)
    assert.equal(dialog.open, false)
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})

test('manual selection works after GPS denial and stays active when permission changes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 28) })
  const status = { state: 'denied', onchange: null }
  t.mock.method(navigator.permissions, 'query', async () => status)
  const gps = t.mock.method(navigator.geolocation, 'watchPosition', (_, fail) => {
    queueMicrotask(() => fail({ code: 1 }))
    return 1
  })
  const requests = []
  let signal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url)
    signal = options.signal
    return Response.json({ ac: [], now: Date.now() })
  })
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.equal(requests.length, 0)
    assert.ok(target.querySelector('.fids-empty__location'))
    target.querySelector('.fids-empty__location').click()
    await flush()
    target.querySelector('.test-location-apply').click()
    await flush()
    assert.equal(requests.length, 1)
    assert.match(requests[0], /\/point\/35\.180\/129\.076\//)
    assert.match(target.querySelector('.footer').textContent, /직접 선택한 조회 위치/)
    assert.equal(target.querySelector('.radar__you').getAttribute('aria-label'), '선택한 위치')
    assert.match(target.querySelector('.permission-badge').textContent, /차단됨/)
    status.onchange()
    t.mock.timers.tick(5000)
    await flush()
    assert.equal(requests.length, 2, 'GPS denial must not stop a manual-location scan')
    assert.equal(gps.mock.callCount(), 1)
    const previousSignal = signal
    target.querySelector('.radar-panel__location button').click()
    await flush()
    target.querySelector('.test-location-apply').click()
    await flush()
    assert.equal(previousSignal.aborted, true)
    assert.equal(requests.length, 3)
    // Returning to GPS must not discard the manual scan when permission is denied.
    target.querySelector('.radar-panel__device-location').click()
    await flush()
    assert.equal(gps.mock.callCount(), 2)
    assert.match(
      target.querySelector('.radar-panel__location-error').textContent,
      /현재 조회 위치는 유지/,
    )
    assert.equal(target.querySelector('.radar__you').getAttribute('aria-label'), '선택한 위치')
    t.mock.timers.tick(5000)
    await flush()
    assert.match(requests[3], /\/point\/35\.180\/129\.076\//)
    status.state = 'granted'
    gps.mock.mockImplementation((success) => {
      queueMicrotask(() =>
        success({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 100 } }),
      )
      return 2
    })
    target.querySelector('.settings-fab').click()
    target.querySelector('.setting-group--location .permission-button').click()
    await flush()
    assert.equal(
      gps.mock.callCount(),
      3,
      'returning to GPS uses the acquired position without a second GPS request',
    )
    assert.match(requests[4], /\/point\/37\.566\/126\.978\//)
    assert.equal(target.querySelector('.radar-panel__location-error'), null)
    assert.equal(target.querySelector('.radar__you').getAttribute('aria-label'), '내 위치')
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})

test('manual location bypasses the secure-context GPS restriction', async (t) => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  const gps = t.mock.method(navigator.geolocation, 'watchPosition')
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1
    return Response.json({ ac: [], now: Date.now() })
  })
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.ok(target.querySelector('.fids-empty__location'))
    target.querySelector('.fids-empty__location').click()
    await flush()
    target.querySelector('.test-location-apply').click()
    await flush()
    assert.equal(requests, 1)
    assert.equal(gps.mock.callCount(), 0)
    assert.match(target.querySelector('.header__status').textContent, /조회 중/)
  } finally {
    app.unmount()
    target.remove()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  }
})

test('a late GPS result cannot replace a manually selected center', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 28) })
  let gpsSuccess
  t.mock.method(navigator.geolocation, 'watchPosition', (success) => {
    gpsSuccess = success
    return 1
  })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url)
    return Response.json({ ac: [], now: Date.now() })
  })
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    assert.equal(requests.length, 0)
    target.querySelector('.radar-panel__location button').click()
    await flush()
    target.querySelector('.test-location-apply').click()
    await flush()
    gpsSuccess({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 100 } })
    await flush()
    t.mock.timers.tick(5000)
    await flush()
    assert.equal(requests.length, 2)
    assert.ok(requests.every((url) => url.includes('/point/35.180/129.076/')))
    // A GPS return request must also respect a later manual selection or stop.
    target.querySelector('.radar-panel__device-location').click()
    await flush()
    assert.equal(target.querySelector('.radar-panel__device-location').disabled, true)
    const pendingGps = gpsSuccess
    target.querySelector('.radar-panel__location button').click()
    await flush()
    target.querySelector('.test-location-apply').click()
    await flush()
    pendingGps({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 100 } })
    await flush()
    assert.equal(requests.length, 3)
    assert.match(requests[2], /\/point\/35\.180\/129\.076\//)
    target.querySelector('.radar-panel__device-location').click()
    await flush()
    target.querySelector('.scan-button').click()
    gpsSuccess({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 100 } })
    await flush()
    t.mock.timers.tick(5000)
    await flush()
    assert.equal(requests.length, 3)
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})

test('a permitted compass resumes after returning and keeps the posture hint while tilted', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 28) })
  const originalOrientation = Object.getOwnPropertyDescriptor(window, 'DeviceOrientationEvent')
  const originalTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
  let permissionRequests = 0
  Object.defineProperty(window, 'DeviceOrientationEvent', {
    configurable: true,
    value: {
      requestPermission: async () => {
        permissionRequests += 1
        return 'granted'
      },
    },
  })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ac: [], now: Date.now() }))
  const orientation = (beta) => {
    const event = new window.Event('deviceorientationabsolute')
    Object.assign(event, { absolute: true, alpha: 270, beta, gamma: 0 })
    window.dispatchEvent(event)
  }
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    target.querySelector('.compass-button').click()
    await flush()
    orientation(0)
    await flush()
    assert.match(target.querySelector('.radar-panel__direction').textContent, /나침반/)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new window.Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new window.Event('visibilitychange'))
    orientation(0)
    await flush()
    assert.equal(permissionRequests, 1)
    assert.match(target.querySelector('.radar-panel__direction').textContent, /나침반/)
    for (let i = 0; i < 3; i += 1) {
      orientation(85)
      t.mock.timers.tick(3000)
      await flush()
    }
    assert.match(target.querySelector('.radar-panel__sensor-message').textContent, /수평/)
  } finally {
    app.unmount()
    target.remove()
    if (originalOrientation)
      Object.defineProperty(window, 'DeviceOrientationEvent', originalOrientation)
    else delete window.DeviceOrientationEvent
    if (originalTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', originalTouchPoints)
    else delete navigator.maxTouchPoints
    t.mock.timers.reset()
  }
})

test('reduced motion pauses rotation and board focus prevents unexpected flight changes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.UTC(2026, 9, 28) })
  const matchMedia = window.matchMedia.bind(window)
  t.mock.method(window, 'matchMedia', (query) => {
    const media = matchMedia(query)
    if (query === '(prefers-reduced-motion: reduce)')
      Object.defineProperty(media, 'matches', { value: true })
    return media
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(Dashboard)
  app.mount(target)
  try {
    await flush()
    target.querySelector('.fids-empty__preview').click()
    await flush()
    const rotation = target.querySelector('.flight-board__rotation')
    const flight = () => target.querySelector('.split-flap--callsign').textContent
    const first = flight()
    assert.equal(rotation.getAttribute('aria-pressed'), 'true')
    assert.equal(target.querySelector('.flight-board__content').getAttribute('aria-live'), null)
    t.mock.timers.tick(10000)
    await flush()
    assert.equal(flight(), first)
    rotation.click()
    rotation.focus()
    await flush()
    t.mock.timers.tick(10000)
    await flush()
    assert.equal(flight(), first)
    rotation.blur()
    t.mock.timers.tick(10000)
    await flush()
    assert.notEqual(flight(), first)
    assert.ok(target.querySelector('.service-guide dl').textContent.includes('위치 권한'))
  } finally {
    app.unmount()
    target.remove()
    t.mock.timers.reset()
  }
})
