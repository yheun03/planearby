import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApiHandler, isMatchingFlight } from '../server/api/aircraft.js'
import { SEARCH_RADIUS_KM, SEARCH_RADIUS_NM } from '../utils/geo.js'

const timestamp = Date.UTC(2026, 9, 27, 4)
const observed = { id: 'abc123', callsign: 'KAL1428', lat: 37.5675, lon: 126.978, type: 'B738' }
const positionResponse = {
  ac: [
    {
      hex: 'abc123',
      flight: ' KAL1428 ',
      lat: 37.5675,
      lon: 126.978,
      t: 'B738',
      track: 52,
      seen_pos: 1,
      alt_baro: 12000,
    },
    { hex: 'midrange', flight: 'MID12', t: 'A321', lat: 37.59, lon: 126.978 },
    {
      hex: 'edge-inside',
      t: 'CRJ9',
      flight: 'EDGE12',
      lat: 37.5665 + (SEARCH_RADIUS_KM - 0.01) / 111.1950802335329,
      lon: 126.978,
    },
    {
      hex: 'edge-outside',
      t: 'B738',
      flight: 'EDGE13',
      lat: 37.5665 + (SEARCH_RADIUS_KM + 0.01) / 111.1950802335329,
      lon: 126.978,
    },
    {
      hex: 'outside',
      t: 'A320',
      flight: 'OUT12',
      lat: 37.5665 + (SEARCH_RADIUS_KM + 2) / 111.1950802335329,
      lon: 126.978,
    },
    { hex: 'stale', flight: 'OLD12', t: 'B738', lat: 37.567, lon: 126.978, seen_pos: 50 },
    { hex: 'ground', flight: 'GND12', t: 'A320', lat: 37.567, lon: 126.978, alt_baro: 'ground' },
    { hex: 'invalid', t: 'B738', lat: null, lon: 126.978 },
    ...['GLEX', 'H160', 'B06', 'E190', 'AT76', null].map((t) => ({
      hex: `excluded-${t}`,
      flight: 'OTHER12',
      t,
      lat: 37.567,
      lon: 126.978,
    })),
    { hex: 'rotorcraft', flight: 'HELI12', t: 'A320', category: 'A7', lat: 37.567, lon: 126.978 },
  ],
}
const detailResponse = {
  flight_icao: 'KAL1428',
  hex: 'ABC123',
  lat: observed.lat,
  lng: observed.lon,
  updated: timestamp / 1000 - 10,
  dep_time_ts: timestamp / 1000 - 3600,
  arr_time_ts: timestamp / 1000 + 3600,
  airline_iata: 'KE',
  aircraft_icao: 'B738',
  dep_iata: 'ICN',
  arr_iata: 'FUK',
  dep_time: '2026-10-27 12:00',
  arr_time: '2026-10-27 14:00',
  dep_estimated: '2026-10-27 12:30',
  arr_estimated: '2026-10-27 14:30',
  dep_actual: '2026-10-27 12:40',
  arr_actual: '2026-10-27 14:40',
}
const routeResponse = {
  callsign: 'KAL1428',
  callsign_icao: 'KAL1428',
  origin: { iata_code: 'ICN', icao_code: 'RKSI', name: 'Incheon International Airport' },
  destination: { iata_code: 'FUK', icao_code: 'RJFF', name: 'Fukuoka Airport' },
}

async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'planearby-test-'))
  const budgetFile = join(directory, 'usage.json')
  const calls = []
  const requestHeaders = []
  const fetchImpl =
    options.fetchImpl ||
    (async (url, options) => {
      calls.push(String(url))
      requestHeaders.push(options.headers)
      return Response.json(
        String(url).includes('adsb.lol')
          ? positionResponse
          : String(url).includes('adsbdb.com')
            ? { response: { flightroute: routeResponse } }
            : { response: detailResponse },
      )
    })
  const server = createServer(
    createApiHandler({ apiKey: '', now: () => timestamp, budgetFile, ...options, fetchImpl }),
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/api`
  const request = (path, init) => fetch(`${base}${path}`, init)
  const createSession = (body = {}) =>
    request('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 37.5665, lon: 126.978, ...body }),
    })
  const start = async () => (await createSession()).json()
  return {
    request,
    createSession,
    start,
    calls,
    requestHeaders,
    budgetFile,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('only a current, matching aircraft can supply schedule details', () => {
  assert.equal(isMatchingFlight(observed, detailResponse, timestamp), true)
  for (const changes of [
    { flight_icao: 'KAL999' },
    { hex: 'other' },
    { lat: 35 },
    { lat: null },
    { updated: timestamp / 1000 - 3600 },
    { dep_time_ts: timestamp / 1000 + 86400 },
    { arr_time_ts: timestamp / 1000 - 86400 },
    { dep_time_ts: null },
  ])
    assert.equal(isMatchingFlight(observed, { ...detailResponse, ...changes }, timestamp), false)
})

test('invalid locations and malformed JSON cannot create a session', async () => {
  const f = await fixture()
  try {
    for (const body of [{ lat: 91 }, { lon: -181 }, { lat: '37' }])
      assert.equal((await f.createSession(body)).status, 400)
    const response = await f.request('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    assert.equal(response.status, 400)
    assert.equal(f.calls.length, 0)
  } finally {
    await f.close()
  }
})

test('cross-origin session creation is rejected', async () => {
  const f = await fixture()
  try {
    const response = await f.request('/session', {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 403)
  } finally {
    await f.close()
  }
})

test('nearby data includes aircraft within the configured radius and excludes farther, stale, ground, and invalid positions', async () => {
  const f = await fixture()
  try {
    const { id } = await f.start()
    const response = await f.request(`/nearby?session=${id}`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(
      body.aircraft.map((flight) => flight.id),
      ['abc123', 'midrange', 'edge-inside'],
    )
    assert.equal(body.aircraft[0].callsign, 'KAL1428')
    assert.equal(body.aircraft[0].airlineCode, 'KE')
    assert.equal(body.aircraft[0].airlineName, 'Korean Air')
    assert.equal(body.aircraft[0].airlineSource, 'callsign')
    assert.equal(body.detailsAvailable, true)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    await f.request(`/nearby?session=${id}`)
    assert.equal(f.calls.length, 1, 'rapid repeat polls reuse the server cache')
    assert.ok(f.calls[0].endsWith(`/${SEARCH_RADIUS_NM}`), 'the request uses nautical miles')
    assert.match(f.requestHeaders[0]['User-Agent'], /Planearby.*https:\/\//)
  } finally {
    await f.close()
  }
})

test('session duration is capped at 30 seconds and expired sessions cannot call upstream APIs', async () => {
  let current = timestamp
  const f = await fixture({ now: () => current })
  try {
    const response = await f.createSession({ durationMs: 100000 })
    const session = await response.json()
    assert.equal(session.expiresAt, timestamp + 30000)
    current += 30001
    assert.equal((await f.request(`/nearby?session=${session.id}`)).status, 410)
    assert.equal(f.calls.length, 0)
  } finally {
    await f.close()
  }
})

test('unknown callsigns cannot consume the flight-detail allowance', async () => {
  const f = await fixture({ apiKey: 'server-test-key' })
  try {
    const { id } = await f.start()
    assert.equal((await f.request(`/flight?session=${id}&callsign=KAL999`)).status, 400)
    assert.equal(f.calls.length, 0)
  } finally {
    await f.close()
  }
})

test('without a key, callsign routes are fetched for free and never invented as verified schedules', async () => {
  const f = await fixture()
  try {
    const { id } = await f.start()
    await f.request(`/nearby?session=${id}`)
    const responses = await Promise.all([
      f.request(`/flight?session=${id}&callsign=KAL1428`),
      f.request(`/flight?session=${id}&callsign=KAL1428`),
    ])
    const body = await responses[0].json()
    assert.deepEqual(await responses[1].json(), body)
    assert.equal(body.detailsStatus, 'route')
    assert.equal(body.dep, 'ICN')
    assert.equal(body.arr, 'FUK')
    assert.equal(body.depName, 'Incheon International Airport')
    assert.equal(body.depTime, null)
    assert.equal(body.arrTime, null)
    assert.ok(f.calls[1].startsWith('https://api.adsbdb.com/v0/callsign/KAL1428'))
    assert.equal(
      f.calls.some((url) => url.includes('airlabs.co')),
      false,
    )
    await f.request(`/flight?session=${id}&callsign=KAL1428`)
    assert.equal(f.calls.length, 2)
  } finally {
    await f.close()
  }
})

test('free route lookups are capped per session independently of paid request budgets', async () => {
  let routeRequests = 0
  const f = await fixture({
    fetchImpl: async (url) => {
      if (String(url).includes('adsb.lol'))
        return Response.json({
          ac: Array.from({ length: 15 }, (_, i) => ({
            hex: `aircraft${i}`,
            flight: `KAL${1000 + i}`,
            t: 'B738',
            lat: 37.5675,
            lon: 126.978,
          })),
        })
      routeRequests += 1
      return new Response(null, { status: 404 })
    },
  })
  try {
    const { id, schedulesAvailable } = await f.start()
    assert.equal(schedulesAvailable, false)
    await f.request(`/nearby?session=${id}`)
    for (let i = 0; i < 15; i += 1) await f.request(`/flight?session=${id}&callsign=KAL${1000 + i}`)
    assert.equal(routeRequests, 12)
    assert.throws(() => readFileSync(f.budgetFile), { code: 'ENOENT' })
  } finally {
    await f.close()
  }
})

test('unknown, mismatched and failed free routes leave the aircraft positions available', async () => {
  for (const routeResult of [
    () => new Response(null, { status: 404 }),
    () => new Response(null, { status: 503 }),
    () =>
      Response.json({
        response: {
          flightroute: { ...routeResponse, callsign: 'KAL999', callsign_icao: 'KAL999' },
        },
      }),
  ]) {
    const f = await fixture({
      fetchImpl: async (url) =>
        String(url).includes('adsb.lol') ? Response.json(positionResponse) : routeResult(),
    })
    try {
      const { id } = await f.start()
      await f.request(`/nearby?session=${id}`)
      assert.deepEqual(await (await f.request(`/flight?session=${id}&callsign=KAL1428`)).json(), {
        detailsStatus: 'unavailable',
      })
      const nearby = await (await f.request(`/nearby?session=${id}`)).json()
      assert.equal(nearby.aircraft.length, 3)
    } finally {
      await f.close()
    }
  }
})

test('concurrent detail requests reuse one paid call and never disclose the server key', async () => {
  const f = await fixture({ apiKey: 'server-test-key' })
  try {
    const { id } = await f.start()
    await f.request(`/nearby?session=${id}`)
    const responses = await Promise.all([
      f.request(`/flight?session=${id}&callsign=KAL1428`),
      f.request(`/flight?session=${id}&callsign=KAL1428`),
    ])
    for (const response of responses) {
      const body = await response.json()
      assert.equal(body.detailsStatus, 'verified')
      assert.equal(body.depTime, '12:00')
      assert.equal(body.arrTime, '14:00')
      assert.equal(body.airlineCode, 'KE')
      assert.equal(body.airlineSource, 'api')
      assert.equal(JSON.stringify(body).includes('server-test-key'), false)
    }
    assert.equal(f.calls.filter((url) => url.includes('airlabs.co')).length, 1)
    const ledger = readFileSync(f.budgetFile, 'utf8')
    assert.deepEqual(JSON.parse(ledger), { month: '2026-10', count: 1 })
    assert.equal(ledger.includes('37.5665'), false)
  } finally {
    await f.close()
  }
})

test('unverified details do not expose a different flight’s route', async () => {
  const f = await fixture({
    apiKey: 'server-test-key',
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('adsb.lol')
          ? positionResponse
          : { response: { ...detailResponse, hex: 'other' } },
      ),
  })
  try {
    const { id } = await f.start()
    await f.request(`/nearby?session=${id}`)
    assert.deepEqual(await (await f.request(`/flight?session=${id}&callsign=KAL1428`)).json(), {
      detailsStatus: 'unverified',
    })
  } finally {
    await f.close()
  }
})

test('verified details without an airline keep the callsign-derived IATA and name', async () => {
  const f = await fixture({
    apiKey: 'server-test-key',
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('adsb.lol')
          ? positionResponse
          : { response: { ...detailResponse, airline_iata: null, airline_icao: null } },
      ),
  })
  try {
    const { id } = await f.start()
    await f.request(`/nearby?session=${id}`)
    const body = await (await f.request(`/flight?session=${id}&callsign=KAL1428`)).json()
    assert.equal(body.detailsStatus, 'verified')
    assert.equal(body.airlineCode, 'KE')
    assert.equal(body.airlineName, 'Korean Air')
    assert.equal(body.airlineSource, 'callsign')
    assert.equal(body.dep, 'ICN')
  } finally {
    await f.close()
  }
})

test('the persisted monthly budget prevents another paid call', async () => {
  const f = await fixture({ apiKey: 'server-test-key', monthlyLimit: 1 })
  try {
    writeFileSync(f.budgetFile, JSON.stringify({ month: '2026-10', count: 1 }))
    // A new instance reads the persisted counter, like a process restart.
    const server = createServer(
      createApiHandler({
        apiKey: 'server-test-key',
        monthlyLimit: 1,
        budgetFile: f.budgetFile,
        now: () => timestamp,
        fetchImpl: async (url) => {
          assert.ok(String(url).includes('adsb.lol'))
          return Response.json(positionResponse)
        },
      }),
    )
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const base = `http://127.0.0.1:${server.address().port}/api`
      const { id } = await (
        await fetch(`${base}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: 37.5665, lon: 126.978 }),
        })
      ).json()
      await fetch(`${base}/nearby?session=${id}`)
      const response = await fetch(`${base}/flight?session=${id}&callsign=KAL1428`)
      assert.equal(response.status, 429)
      assert.equal((await response.json()).code, 'QUOTA_EXCEEDED')
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    await f.close()
  }
})

test('stopping actively cancels an in-progress upstream request', async () => {
  let confirmStarted
  let aborted = false
  const started = new Promise((resolve) => {
    confirmStarted = resolve
  })
  const f = await fixture({
    fetchImpl: async (_, { signal }) => {
      confirmStarted()
      return new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        ),
      )
    },
  })
  try {
    const { id } = await f.start()
    const nearby = f.request(`/nearby?session=${id}`)
    await started
    assert.equal((await f.request(`/session/${id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await nearby).status, 410)
    assert.equal(aborted, true)
    assert.equal((await f.request(`/nearby?session=${id}`)).status, 410)
  } finally {
    await f.close()
  }
})

test('short sessions expire actively without a follow-up request', async () => {
  let aborted = false
  const f = await fixture({
    fetchImpl: async (_, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        ),
      ),
  })
  try {
    const { id } = await (await f.createSession({ durationMs: 40 })).json()
    const response = await f.request(`/nearby?session=${id}`)
    assert.equal(response.status, 410)
    assert.equal(aborted, true)
  } finally {
    await f.close()
  }
})
