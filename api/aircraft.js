import { SEARCH_RADIUS_NM } from '../utils/geo.js'

export default async function aircraftApi(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const limitHeaders = [
    'Retry-After',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ]
  res.setHeader('Access-Control-Expose-Headers', limitHeaders.join(', '))
  res.setHeader('Cache-Control', 'no-store')
  const send = (status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return send(405, { error: 'method_not_allowed' })
  }

  const { searchParams } = new URL(req.url, 'http://localhost')
  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))
  if (
    !searchParams.get('lat')?.trim() ||
    !searchParams.get('lon')?.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return send(400, { error: 'invalid_coordinates' })

  try {
    // Only this fixed upstream and configured radius are allowed; no keys or public proxy.
    const response = await fetch(
      `https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${SEARCH_RADIUS_NM}`,
      { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } },
    )
    limitHeaders.forEach((name) => {
      const value = response.headers.get(name)
      if (value !== null) res.setHeader(name, value)
    })
    if (!response.ok) {
      return send(response.status, { error: 'upstream_error' })
    }
    const body = await response.json()
    if (!Array.isArray(body.ac)) return send(502, { error: 'invalid_upstream_response' })
    return send(200, body)
  } catch {
    return send(502, { error: 'upstream_unavailable' })
  }
}
