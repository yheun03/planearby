import test from 'node:test'
import assert from 'node:assert/strict'
import { createFlightClient } from '../utils/flights.js'
import { SEARCH_RADIUS_KM } from '../utils/geo.js'

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

test('positions use the app API without credentials and filter unsupported or invalid observations', async () => {
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
  assert.ok(calls[0].url.startsWith('/api/aircraft?lat=37.566&lon=126.978'))
  assert.equal(calls[0].options.credentials, 'omit')
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
      if (url.startsWith('/api/aircraft')) return positions([aircraft], now)
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
