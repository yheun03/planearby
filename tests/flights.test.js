import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { transformWithEsbuild } from 'vite'
import { createFlightClient } from '../utils/flights.js'
import { SEARCH_RADIUS_KM, SEARCH_RADIUS_NM } from '../utils/geo.js'

const center = { lat: 37.5665, lon: 126.978 }
const aircraft = {
  hex: 'abc123',
  flight: ' KAL1428 ',
  lat: 37.5675,
  lon: 126.978,
  t: 'B738',
  track: -1,
  seen_pos: 1,
}
const route = {
  callsign_icao: 'KAL1428',
  origin: { iata_code: 'ICN', name: 'Incheon' },
  destination: { iata_code: 'FUK', name: 'Fukuoka' },
}
const positions = (ac, now = Date.now()) => Response.json({ ac, now })

test('development, custom relays and static builds select the correct endpoint', async () => {
  const source = await readFile(new URL('../utils/flights.js', import.meta.url), 'utf8')
  await mkdir(new URL('../.data/', import.meta.url), { recursive: true })
  for (const [index, environment] of [
    { DEV: true, VITE_AIRCRAFT_API_URL: 'https://example.com/api/aircraft' },
    { DEV: false, VITE_AIRCRAFT_API_URL: ' https://example.com/api/aircraft ' },
    { DEV: false },
    { DEV: false, VITE_AIRCRAFT_API_URL: ' ' },
  ].entries()) {
    const file = new URL(`../.data/flights-env-${index}.mjs`, import.meta.url)
    const { code } = await transformWithEsbuild(source, 'flights.js', {
      define: {
        'import.meta.env': JSON.stringify(environment),
      },
    })
    await writeFile(
      file,
      code.replaceAll("from './", "from '../utils/").replaceAll('from "./', 'from "../utils/'),
    )
    try {
      const { createFlightClient: createConfiguredClient } = await import(file.href)
      let requested
      const client = createConfiguredClient({
        fetchImpl: async (url) => {
          requested = url
          return positions([aircraft])
        },
      })
      assert.equal((await client.nearby(center)).length, 1)
      assert.equal(
        requested,
        environment.DEV
          ? '/api/aircraft?lat=37.566&lon=126.978'
          : environment.VITE_AIRCRAFT_API_URL?.trim()
            ? 'https://example.com/api/aircraft?lat=37.566&lon=126.978'
            : `https://proxy.cors.dev/https://api.adsb.lol/v2/point/37.566/126.978/${SEARCH_RADIUS_NM}`,
      )
    } finally {
      await rm(file, { force: true })
    }
  }
})

test('static positions use adsb.lol through CORS without credentials and filter invalid observations', async () => {
  const calls = []
  const client = createFlightClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return positions([
        aircraft,
        ...['GLEX', 'H160', 'E190', 'AT76', 'unknown'].map((t) => ({ ...aircraft, t })),
        { ...aircraft, hex: 'ground', alt_baro: 'ground' },
        { ...aircraft, hex: 'old', seen_pos: 40 },
        { ...aircraft, hex: 'invalid', lat: null },
        { ...aircraft, hex: 'far', lat: center.lat + (SEARCH_RADIUS_KM + 2) / 111 },
        null,
      ])
    },
  })
  const flights = await client.nearby(center)
  assert.equal(flights.length, 1)
  assert.equal(flights[0].callsign, 'KAL1428')
  assert.equal(flights[0].airlineCode, 'KE')
  assert.equal(flights[0].track, 359)
  assert.equal(
    calls[0].url,
    `https://proxy.cors.dev/https://api.adsb.lol/v2/point/37.566/126.978/${SEARCH_RADIUS_NM}`,
  )
  assert.equal(calls[0].options.credentials, 'omit')
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer')
  assert.equal(calls[0].options.headers, undefined)
})

test('source data older than 30 seconds is never represented as current positions', async () => {
  const client = createFlightClient({
    fetchImpl: async () => positions([aircraft], Date.now() - 60000),
  })
  await assert.rejects(client.nearby(center), (error) => error.uiKey === 'staleData')
})

test('a configured production relay receives only rounded coordinates', async () => {
  let requested
  const client = createFlightClient({
    positionEndpoint: 'https://example.com/api/aircraft',
    fetchImpl: async (url) => {
      requested = url
      return positions([aircraft])
    },
  })
  assert.equal((await client.nearby(center)).length, 1)
  assert.equal(requested, 'https://example.com/api/aircraft?lat=37.566&lon=126.978')
})

test('an unconfigured static host and a forbidden provider produce specific errors', async () => {
  for (const [status, key] of [
    [404, 'apiNotConfigured'],
    [403, 'apiForbidden'],
  ]) {
    const client = createFlightClient({ fetchImpl: async () => new Response(null, { status }) })
    await assert.rejects(
      client.nearby(center),
      (error) =>
        error.uiKey === key &&
        (status === 404 ? error.permanent === true : error.retryMs === 300000),
    )
  }
})

test('routes are reference data, concurrent requests reuse one call, and the cache expires', async () => {
  let now = 100000
  let calls = 0
  const client = createFlightClient({
    now: () => now,
    fetchImpl: async () => {
      calls += 1
      return Response.json({ response: { flightroute: route } })
    },
  })
  const [a, b] = await Promise.all([client.route(' KAL1428 '), client.route('KAL1428')])
  assert.deepEqual(a, b)
  assert.equal(a.detailsStatus, 'route')
  assert.equal(a.dep, 'ICN')
  assert.equal(a.arr, 'FUK')
  assert.equal(a.depTime, undefined)
  await client.route('KAL1428')
  assert.equal(calls, 1)
  now += 21600001
  await client.route('KAL1428')
  assert.equal(calls, 2)
})

test('missing, mismatched and partial routes never invent airports or times', async () => {
  for (const result of [
    null,
    { ...route, callsign_icao: 'OTHER12' },
    { callsign_icao: 'KAL1428' },
  ]) {
    const client = createFlightClient({
      fetchImpl: async () =>
        result
          ? Response.json({ response: { flightroute: result } })
          : new Response(null, { status: 404 }),
    })
    const data = await client.route('KAL1428')
    assert.equal(data.dep || null, null)
    assert.equal(data.arr || null, null)
    assert.equal(data.depTime, undefined)
  }
})

test('429 honors Retry-After and route throttling does not stop positions', async () => {
  let now = 100000
  let routeCalls = 0
  const client = createFlightClient({
    now: () => now,
    fetchImpl: async (url) => {
      if (url.startsWith('https://proxy.cors.dev/')) return positions([aircraft], now)
      routeCalls += 1
      return new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    },
  })
  await client.route('KAL1428')
  await client.route('AAR102')
  assert.equal(routeCalls, 1)
  assert.equal((await client.nearby(center)).length, 1)
  now += 60001
  await client.route('AAR102')
  assert.equal(routeCalls, 2)
  const blocked = createFlightClient({
    fetchImpl: async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
  })
  await assert.rejects(blocked.nearby(center), (error) => error.retryMs === 60000)
})

test('daily quota exhaustion is distinct from short throttling and network failures', async () => {
  const policies = '4;w=1, 60;w=60, 500;w=86400'
  for (const [activeLimit, remaining, reset, exhausted] of [
    [500, 0, 120, true],
    [500, 1, 120, false],
    [4, 0, 1, false],
    [60, 0, 60, false],
  ]) {
    const client = createFlightClient({
      fetchImpl: async () =>
        new Response(null, {
          status: 429,
          headers: {
            'X-RateLimit-Limit': `${activeLimit}, ${policies}`,
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(reset),
          },
        }),
    })
    await assert.rejects(
      client.nearby(center),
      (error) =>
        error.uiKey === (exhausted ? 'quotaExceeded' : 'rateLimit') &&
        error.permanent === exhausted &&
        error.retryMs === Math.max(15000, reset * 1000),
    )
  }
  const networkFailure = createFlightClient({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  await assert.rejects(networkFailure.nearby(center), { name: 'TypeError' })
})

test('stopping cancels a pending position request', async () => {
  const controller = new AbortController()
  const client = createFlightClient({
    fetchImpl: async (_, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      ),
  })
  const result = client.nearby(center, controller.signal)
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
})

test('KAL2102 is visible near Seowon 2-gil when airborne, while ground reports remain excluded', async () => {
  const center = { lat: 37.4777477, lon: 126.9320313 }
  const observation = {
    hex: '71c730',
    flight: 'KAL2102 ',
    t: 'B78X',
    category: 'A5',
    lat: 37.555098,
    lon: 126.797915,
    seen_pos: 0.55,
  }
  for (const [alt_baro, count] of [
    [1500, 1],
    ['ground', 0],
  ]) {
    const client = createFlightClient({
      fetchImpl: async () => positions([{ ...observation, alt_baro }]),
    })
    const results = await client.nearby(center)
    assert.equal(results.length, count)
    if (count) assert.equal(results[0].callsign, 'KAL2102')
  }
})
