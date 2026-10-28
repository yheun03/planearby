import { resolveAirline } from './airlines.js'
import { isSupportedAircraft } from './aircraft.js'
import { distanceKm, normalizeDegrees, SEARCH_RADIUS_KM, SEARCH_RADIUS_NM } from './geo.js'

const callsignCode = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function createFlightClient({
  fetchImpl = fetch,
  now = Date.now,
  positionEndpoint = import.meta.env?.DEV
    ? '/api/aircraft'
    : import.meta.env?.VITE_AIRCRAFT_API_URL?.trim() || '',
} = {}) {
  const routes = new Map()
  const pendingRoutes = new Map()
  let routeRetryAt = 0

  async function request(url, signal) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)].filter(Boolean)),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (response.status === 404) return null
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after')
      const seconds = Number(retryAfter)
      const delay =
        retryAfter && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now()
      const resetMs = Number(response.headers.get('x-ratelimit-reset')) * 1000
      // Envoy lists the active quota first, followed by each policy's time window.
      const policies = (response.headers.get('x-ratelimit-limit') || '').split(',')
      const activeLimit = Number(policies[0])
      const dailyQuota = policies.slice(1).some((policy) => {
        const match = /^\s*(\d+)\s*;\s*w=(\d+)(?:\s*;|\s*$)/.exec(policy)
        return match && Number(match[1]) === activeLimit && Number(match[2]) >= 86400
      })
      const remaining = response.headers.get('x-ratelimit-remaining')
      const quotaExhausted =
        response.status === 429 && dailyQuota && (remaining === null || Number(remaining) === 0)
      throw {
        uiKey: quotaExhausted
          ? 'quotaExceeded'
          : response.status === 429
            ? 'rateLimit'
            : response.status === 403
              ? 'apiForbidden'
              : 'apiError',
        retryMs: Math.max(
          response.status === 403 ? 300000 : 15000,
          delay || 0,
          response.status === 429 ? resetMs || (quotaExhausted ? 86400000 : 0) : 0,
        ),
        permanent: quotaExhausted,
      }
    }
    return response.json()
  }

  return {
    async nearby(center, signal) {
      const query = new URLSearchParams({ lat: center.lat.toFixed(3), lon: center.lon.toFixed(3) })
      // Static hosts cannot run /api/aircraft. This keyless relay adds browser CORS headers.
      const url = positionEndpoint
        ? `${positionEndpoint}?${query}`
        : `https://proxy.cors.dev/https://api.adsb.lol/v2/point/${query.get('lat')}/${query.get('lon')}/${SEARCH_RADIUS_NM}`
      const body = await request(url, signal)
      if (body === null) throw { uiKey: 'apiNotConfigured', permanent: true }
      if (!Array.isArray(body?.ac)) throw { uiKey: 'apiError' }
      const sourceTime = Number(body.now)
      const age =
        finite(sourceTime) && sourceTime > 0
          ? Math.max(0, (now() - sourceTime * (sourceTime < 1e11 ? 1000 : 1)) / 1000)
          : 0
      if (age > 30) throw { uiKey: 'staleData' }
      return body.ac
        .filter(
          (item) =>
            item &&
            finite(item.lat) &&
            finite(item.lon) &&
            Math.abs(item.lat) <= 90 &&
            Math.abs(item.lon) <= 180 &&
            item.alt_baro !== 'ground' &&
            (item.seen_pos == null || item.seen_pos + age <= 30) &&
            isSupportedAircraft({ type: item.t, category: item.category }),
        )
        .map((item) => ({
          id: String(item.hex || ''),
          callsign: callsignCode(item.flight),
          lat: item.lat,
          lon: item.lon,
          track: finite(item.track) ? normalizeDegrees(item.track) : null,
          type: item.t.trim().toUpperCase(),
          registration: typeof item.r === 'string' ? item.r : null,
        }))
        .filter((item) => item.id && distanceKm(center, item) <= SEARCH_RADIUS_KM)
        .map((item) => ({ ...item, ...resolveAirline(item) }))
        .sort((a, b) => distanceKm(center, a) - distanceKm(center, b))
    },
    async route(value, signal) {
      const callsign = callsignCode(value)
      if (!/^[A-Z0-9]{2,10}$/.test(callsign)) return { detailsStatus: 'unavailable' }
      const cached = routes.get(callsign)
      if (cached?.expiresAt > now()) return cached.data
      if (pendingRoutes.has(callsign)) return pendingRoutes.get(callsign)
      if (routeRetryAt > now()) return { detailsStatus: 'unavailable' }
      const pending = (async () => {
        let data = { detailsStatus: 'unavailable' }
        let ttl = 3600000
        try {
          const body = await request(
            `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
            signal,
          )
          const route = body?.response?.flightroute
          if (
            route &&
            [route.callsign, route.callsign_icao, route.callsign_iata].some(
              (code) => callsignCode(code) === callsign,
            )
          ) {
            const airportCode = (airport) =>
              /^[A-Z]{3}$/.test(airport?.iata_code)
                ? airport.iata_code
                : /^[A-Z0-9]{4}$/.test(airport?.icao_code)
                  ? airport.icao_code
                  : null
            data = {
              detailsStatus: 'route',
              dep: airportCode(route.origin),
              arr: airportCode(route.destination),
              depName: typeof route.origin?.name === 'string' ? route.origin.name : null,
              arrName: typeof route.destination?.name === 'string' ? route.destination.name : null,
            }
            ttl = 21600000
          }
        } catch (error) {
          if (signal?.aborted) throw error
          routeRetryAt = now() + (error.retryMs || 30000)
          ttl = 60000
        }
        if (routes.size >= 500) routes.delete(routes.keys().next().value)
        routes.set(callsign, { data, expiresAt: now() + ttl })
        return data
      })()
      pendingRoutes.set(callsign, pending)
      try {
        return await pending
      } finally {
        pendingRoutes.delete(callsign)
      }
    },
  }
}
