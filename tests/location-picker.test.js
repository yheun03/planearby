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
  'Document',
  'ShadowRoot',
  'Element',
  'HTMLElement',
  'SVGElement',
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? browser : browser[key],
  })
const { createApp, nextTick } = await import('vue')
const file = new URL('../.data/location-picker-test.mjs', import.meta.url)
const root = new URL('../', import.meta.url)
const source = new URL(
  '../components/projects/planearby/PlanearbyLocationPicker.vue',
  import.meta.url,
)
const { descriptor } = parse(await readFile(source, 'utf8'))
const compiled = compileScript(descriptor, { id: 'location-picker-test', inlineTemplate: true })
  .content.replace(/import ['"]leaflet\/dist\/leaflet\.css['"]\n?/, '')
  .replace("import('leaflet')", 'loadTestLeaflet()')
  .replace(/from ['"]~\/([^'"]+)['"]/g, (_, path) => `from '${new URL(path, root).href}'`)
await mkdir(new URL('../.data/', import.meta.url), { recursive: true })
await writeFile(
  file,
  `let loadTestLeaflet
export function setLeafletLoader(loader) { loadTestLeaflet = loader }
${compiled}`,
)
const { default: LocationPicker, setLeafletLoader } = await import(file.href)
after(async () => {
  await rm(file, { force: true })
  await browser.happyDOM.abort()
})

function fakeLeaflet() {
  const maps = []
  return {
    maps,
    map(_, options) {
      const listeners = {}
      let center = options.center
      const map = {
        removed: false,
        on(name, listener) {
          listeners[name] = listener
        },
        off() {
          Object.keys(listeners).forEach((name) => delete listeners[name])
        },
        remove() {
          this.removed = true
        },
        invalidateSize() {},
        getCenter: () => ({ wrap: () => ({ lat: center[0], lng: center[1] }) }),
        panTo(next) {
          center = next
          listeners.moveend?.({ target: map })
        },
        setView(next, zoom) {
          this.zoom = zoom
          this.panTo(next)
        },
      }
      maps.push(map)
      return map
    },
    tileLayer() {
      const listeners = {}
      return {
        on(name, listener) {
          listeners[name] = listener
          return this
        },
        addTo() {
          queueMicrotask(() => listeners.load?.())
        },
      }
    },
  }
}

const initialLocation = { lat: 37.5665, lon: 126.978 }
function mountPicker(props = {}) {
  const deviceRequests = []
  const selected = []
  const closed = []
  const target = document.createElement('div')
  document.body.append(target)
  const app = createApp(LocationPicker, {
    initialLocation,
    language: 'ko',
    onSelect: (point) => selected.push(point),
    onClose: () => closed.push(true),
    onDeviceLocation: () => deviceRequests.push(true),
    ...props,
  })
  const picker = app.mount(target)
  return {
    picker,
    target,
    selected,
    closed,
    deviceRequests,
    destroy() {
      app.unmount()
      target.remove()
    },
  }
}

function enterCoordinates(target, lat, lon) {
  const inputs = target.querySelectorAll('input[type="number"]')
  for (const [index, value] of [lat, lon].entries()) {
    inputs[index].value = String(value)
    inputs[index].dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  inputs.forEach((input) => input.dispatchEvent(new window.Event('change', { bubbles: true })))
}
const flush = async () => {
  await new Promise(setImmediate)
  await nextTick()
}

test('valid coordinate submissions emit numeric points, including zero', async () => {
  setLeafletLoader(async () => fakeLeaflet())
  const view = mountPicker()
  try {
    for (const point of [
      { lat: 35.1796, lon: 129.0756 },
      { lat: 0, lon: 0 },
    ]) {
      await view.picker.open()
      enterCoordinates(view.target, point.lat, point.lon)
      view.target.querySelector('.location-picker__apply').click()
      await flush()
      assert.equal(view.target.querySelector('dialog').open, false)
      assert.deepEqual(view.selected.at(-1), point)
    }
    assert.equal(view.selected.length, 2)
  } finally {
    view.destroy()
  }
})

test('blank or out-of-range coordinates show validation without emitting a point', async () => {
  setLeafletLoader(async () => fakeLeaflet())
  const view = mountPicker()
  try {
    await view.picker.open()
    for (const [lat, lon] of [
      ['', 127],
      [37, ''],
      [91, 127],
      [37, 181],
      [-91, 0],
      [0, -181],
    ]) {
      enterCoordinates(view.target, lat, lon)
      view.target.querySelector('.location-picker__apply').click()
      await flush()
      assert.ok(view.target.querySelector('#location-picker-error'))
      assert.equal(view.target.querySelector('dialog').open, true)
      assert.equal(view.selected.length, 0)
    }
  } finally {
    view.destroy()
  }
})

test('closing removes the map and reopening discards unconfirmed edits', async () => {
  const leaflet = fakeLeaflet()
  setLeafletLoader(async () => leaflet)
  const view = mountPicker()
  try {
    await view.picker.open()
    enterCoordinates(view.target, 35, 129)
    view.picker.close()
    await flush()
    assert.equal(leaflet.maps[0].removed, true)
    assert.equal(view.closed.length, 1)
    await view.picker.open()
    const inputs = view.target.querySelectorAll('input[type="number"]')
    assert.equal(Number(inputs[0].value), initialLocation.lat)
    assert.equal(Number(inputs[1].value), initialLocation.lon)
    assert.equal(leaflet.maps.length, 2)
    assert.equal(view.selected.length, 0)
  } finally {
    view.destroy()
  }
  assert.equal(leaflet.maps[1].removed, true)
})

test('a late map import cannot initialize a map after the dialog closes', async () => {
  const leaflet = fakeLeaflet()
  let completeImport
  setLeafletLoader(() => new Promise((resolve) => (completeImport = resolve)))
  const view = mountPicker()
  try {
    const opening = view.picker.open()
    await flush()
    assert.equal(typeof completeImport, 'function')
    view.picker.close()
    await flush()
    completeImport(leaflet)
    await opening
    assert.equal(leaflet.maps.length, 0)
    assert.equal(view.target.querySelector('dialog').open, false)
  } finally {
    view.destroy()
  }
})

test('map load failure still permits coordinates to be applied', async () => {
  setLeafletLoader(async () => {
    throw new Error('Map unavailable')
  })
  const view = mountPicker()
  try {
    await view.picker.open()
    await flush()
    assert.ok(view.target.querySelector('.location-picker__map-message'))
    assert.equal(view.target.querySelector('input').disabled, false)
    enterCoordinates(view.target, -33.8688, 151.2093)
    view.target.querySelector('.location-picker__apply').click()
    await flush()
    assert.deepEqual(view.selected, [{ lat: -33.8688, lon: 151.2093 }])
  } finally {
    view.destroy()
  }
})

test('explicit address search selects coordinates and reuses cached results', async (t) => {
  setLeafletLoader(async () => fakeLeaflet())
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls += 1
    assert.equal(new URL(url).searchParams.get('q'), '서울역')
    return Response.json({
      features: [
        {
          properties: { name: '서울역', city: '서울', street: '한강대로' },
          geometry: { type: 'Point', coordinates: [126.972, 37.553] },
        },
      ],
    })
  })
  const view = mountPicker()
  try {
    await view.picker.open()
    const input = view.target.querySelector('input[type="search"]')
    input.value = '서울역'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await flush()
    assert.equal(calls, 0)
    const form = view.target.querySelector('.location-picker__search')
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    assert.match(view.target.querySelector('.location-picker__results').textContent, /서울역/)
    view.target.querySelector('.location-picker__results button').click()
    await flush()
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    assert.equal(calls, 1)
    view.target.querySelector('.location-picker__apply').click()
    await flush()
    assert.deepEqual(view.selected, [{ lat: 37.553, lon: 126.972 }])
  } finally {
    view.destroy()
  }
})

test('editing the query or closing the picker cancels pending address searches', async (t) => {
  setLeafletLoader(async () => fakeLeaflet())
  let complete
  let signal
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  const view = mountPicker()
  try {
    await view.picker.open()
    const input = view.target.querySelector('input[type="search"]')
    input.value = 'Seoul'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await flush()
    view.target
      .querySelector('.location-picker__search')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    input.value = 'Busan'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    assert.equal(signal.aborted, true)
    complete(Response.json({ features: [] }))
    await flush()
    assert.equal(view.target.querySelector('.location-picker__search-message'), null)
    view.picker.close()
    await flush()
  } finally {
    view.destroy()
  }
})

test('current location is accessible from the picker and preserves unconfirmed coordinates', async () => {
  setLeafletLoader(async () => fakeLeaflet())
  const view = mountPicker()
  try {
    await view.picker.open()
    enterCoordinates(view.target, 35.18, 129.07)
    view.target.querySelector('.location-picker__device').click()
    await flush()
    assert.equal(view.deviceRequests.length, 1)
    assert.equal(view.target.querySelector('dialog').open, true)
    assert.equal(Number(view.target.querySelector('input[type="number"]').value), 35.18)
    assert.equal(view.selected.length, 0)
  } finally {
    view.destroy()
  }
})

test('current-location progress prevents duplicate requests and errors remain visible', async () => {
  setLeafletLoader(async () => fakeLeaflet())
  const view = mountPicker({ deviceLocationPending: true, deviceLocationError: 'denied' })
  try {
    await view.picker.open()
    const button = view.target.querySelector('.location-picker__device')
    assert.equal(button.disabled, true)
    assert.match(button.textContent, /내 위치 확인 중/)
    button.click()
    assert.equal(view.deviceRequests.length, 0)
    assert.match(
      view.target.querySelector('.location-picker__error').textContent,
      /현재 조회 위치는 유지/,
    )
  } finally {
    view.destroy()
  }
})

test('Seoul address searches exclude another city and identify a street-only match', async (t) => {
  const leaflet = fakeLeaflet()
  setLeafletLoader(async () => leaflet)
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).searchParams.get('q'), '서울특별시 서원2길 7')
    return Response.json({
      features: [
        {
          properties: { name: '국신원룸', street: '서원2길', city: '울산광역시', housenumber: '7' },
          geometry: { type: 'Point', coordinates: [129.3363382, 35.5630272] },
        },
        {
          properties: { name: '서원2길', city: '서울특별시' },
          geometry: { type: 'Point', coordinates: [126.9320313, 37.4777477] },
        },
        {
          properties: { name: '서원7길', city: '서울특별시' },
          geometry: { type: 'Point', coordinates: [126.933628, 37.4761131] },
        },
        {
          properties: { street: '서원2길', city: '서울특별시', housenumber: '77' },
          geometry: { type: 'Point', coordinates: [126.932, 37.478] },
        },
      ],
    })
  })
  const view = mountPicker()
  try {
    await view.picker.open()
    const input = view.target.querySelector('input[type="search"]')
    input.value = '서울시 서원2길 7'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    view.target
      .querySelector('.location-picker__search')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    assert.equal(view.target.querySelectorAll('.location-picker__results button').length, 1)
    assert.match(view.target.querySelector('.location-picker__results').textContent, /도로 위치/)
    view.target.querySelector('.location-picker__results button').click()
    await flush()
    assert.match(
      view.target.querySelector('.location-picker__search-message').textContent,
      /정확한 건물 대신/,
    )
    assert.equal(leaflet.maps[0].zoom, 16)
    view.target.querySelector('.location-picker__apply').click()
    await flush()
    assert.deepEqual(view.selected, [{ lat: 37.47775, lon: 126.93203 }])
  } finally {
    view.destroy()
  }
})
