import test from 'node:test'
import assert from 'node:assert/strict'
import aircraftApi from '../api/aircraft.js'
import { SEARCH_RADIUS_NM } from '../utils/geo.js'

async function call(url, method = 'GET') {
  const headers = {}
  const response = {
    setHeader(name, value) {
      headers[name] = value
    },
    end(value) {
      this.body = JSON.parse(value)
    },
  }
  await aircraftApi({ url, method }, response)
  return { ...response, headers }
}

test('the app proxy queries only the fixed upstream with rounded coordinates and a fixed radius', async (t) => {
  let request
  t.mock.method(globalThis, 'fetch', async (url) => {
    request = url
    return Response.json({ ac: [], now: Date.now() })
  })
  const result = await call(
    '/api/aircraft?lat=37.5665&lon=126.978&radius=999&url=https://example.com',
  )
  assert.equal(result.statusCode, 200)
  assert.equal(request, `https://api.adsb.lol/v2/point/37.566/126.978/${SEARCH_RADIUS_NM}`)
  assert.deepEqual(result.body.ac, [])
  assert.equal(result.headers['Access-Control-Allow-Origin'], '*')
  assert.equal(result.headers['Cache-Control'], 'no-store')
})

test('invalid coordinates and methods never reach the upstream', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('unexpected upstream'),
  )
  for (const query of [
    '',
    '?lat=&lon=127',
    '?lat=91&lon=127',
    '?lat=37&lon=181',
    '?lat=no&lon=127',
  ]) {
    assert.equal((await call(`/api/aircraft${query}`)).statusCode, 400)
  }
  assert.equal((await call('/api/aircraft?lat=0&lon=0', 'POST')).statusCode, 405)
  assert.equal(upstream.mock.callCount(), 0)
})

test('the proxy preserves upstream limits and reports malformed or failed responses', async (t) => {
  const upstream = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
  )
  const limited = await call('/api/aircraft?lat=0&lon=0')
  assert.equal(limited.statusCode, 429)
  assert.equal(limited.headers['Retry-After'], '60')
  upstream.mock.mockImplementation(async () => new Response(null, { status: 403 }))
  assert.equal((await call('/api/aircraft?lat=0&lon=0')).statusCode, 403)
  upstream.mock.mockImplementation(async () => Response.json({ error: 'invalid' }))
  assert.equal((await call('/api/aircraft?lat=0&lon=0')).statusCode, 502)
  upstream.mock.mockImplementation(async () => {
    throw new TypeError('network failed')
  })
  assert.equal((await call('/api/aircraft?lat=0&lon=0')).statusCode, 502)
})
