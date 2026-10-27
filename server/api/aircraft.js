import { randomUUID } from 'node:crypto'
import { resolveAirline } from '../../utils/airlines.js'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { distanceKm, SEARCH_RADIUS_KM, SEARCH_RADIUS_NM } from '../../utils/geo.js'

const WINDOW_MS = 30_000
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const normalizedCallsign = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')

export function isMatchingFlight(observed, detail, timestamp) {
  if (normalizedCallsign(detail.flight_icao) !== observed.callsign) return false
  if (detail.hex && String(detail.hex).toLowerCase() !== observed.id.toLowerCase()) return false
  if (!validNumber(detail.lat) || !validNumber(detail.lng) || !validNumber(detail.updated))
    return false
  if (Math.abs(timestamp / 1000 - detail.updated) > 900) return false
  if (distanceKm(observed, { lat: detail.lat, lon: detail.lng }) > 30) return false
  // A same-number flight on another date must never supply the route or times.
  if (!validNumber(detail.dep_time_ts) || !validNumber(detail.arr_time_ts)) return false
  return (
    detail.dep_time_ts <= timestamp / 1000 + 3600 &&
    detail.arr_time_ts >= timestamp / 1000 - 3600 &&
    detail.arr_time_ts > detail.dep_time_ts
  )
}

export function createApiHandler({
  apiKey = process.env.AIRLABS_API_KEY || '',
  userAgent = process.env.ADSB_USER_AGENT ||
    'Planearby/1.0 (+https://github.com/yheun03/planearby)',
  monthlyLimit = process.env.AIRLABS_MONTHLY_LIMIT || 1000,
  budgetFile = resolve('.data/airlabs-usage.json'),
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const sessions = new Map()
  const clients = new Map()
  const requestLimit = Math.min(1000, Math.max(1, Number(monthlyLimit) || 1000))
  let budget
  let budgetUnavailable = false
  try {
    budget = JSON.parse(readFileSync(budgetFile, 'utf8'))
  } catch (error) {
    // A corrupt ledger must not silently reset the API allowance.
    if (error.code !== 'ENOENT') budgetUnavailable = true
  }

  function reserveDetailRequest() {
    if (budgetUnavailable) throw { status: 503, code: 'BUDGET_UNAVAILABLE' }
    const month = new Date(now()).toISOString().slice(0, 7)
    if (!budget || budget.month !== month) budget = { month, count: 0 }
    if (!Number.isInteger(budget.count) || budget.count < 0)
      throw { status: 503, code: 'BUDGET_UNAVAILABLE' }
    if (budget.count >= requestLimit) throw { status: 429, code: 'QUOTA_EXCEEDED' }
    // Reserve before making the external request. All outcomes can consume quota.
    budget.count += 1
    try {
      mkdirSync(dirname(budgetFile), { recursive: true })
      writeFileSync(`${budgetFile}.tmp`, JSON.stringify(budget), { mode: 0o600 })
      renameSync(`${budgetFile}.tmp`, budgetFile)
    } catch {
      budgetUnavailable = true
      throw { status: 503, code: 'BUDGET_UNAVAILABLE' }
    }
  }

  const send = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(JSON.stringify(body))
  }

  async function externalJson(url, session) {
    const signal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(8000)])
    try {
      const response = await fetchImpl(url, {
        signal,
        headers: {
          Accept: 'application/json',
          ...(String(url).startsWith('https://api.adsb.lol/') ? { 'User-Agent': userAgent } : {}),
        },
      })
      if (response.status === 429) throw { status: 429, code: 'RATE_LIMIT' }
      if (!response.ok) throw { status: 502, code: 'UPSTREAM_ERROR' }
      return await response.json()
    } catch (error) {
      if (error.code && error.status) throw error
      if (session.controller.signal.aborted) throw { status: 410, code: 'SESSION_EXPIRED' }
      throw { status: 502, code: 'UPSTREAM_ERROR' }
    }
  }

  function removeSession(id) {
    const session = sessions.get(id)
    if (session) {
      session.controller.abort()
      clearTimeout(session.timer)
      sessions.delete(id)
    }
  }

  return async function handleApi(req, res) {
    const url = new URL(req.url, 'http://localhost')
    // Vite's middleware mount removes the /api prefix; production retains it.
    const path = url.pathname.replace(/^\/api(?=\/|$)/, '')
    const ip = req.socket.remoteAddress || 'local'
    const origin = req.headers.origin
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host)
          return send(res, 403, { code: 'ORIGIN_DENIED' })
      } catch {
        return send(res, 403, { code: 'ORIGIN_DENIED' })
      }
    }
    try {
      for (const [id, session] of sessions) if (session.expiresAt <= now()) removeSession(id)
      for (const [address, client] of clients) if (client.resetAt <= now()) clients.delete(address)

      if (path === '/session' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(res, 415, { code: 'JSON_REQUIRED' })
        let text = ''
        for await (const chunk of req) {
          text += chunk
          if (text.length > 512) return send(res, 413, { code: 'BODY_TOO_LARGE' })
        }
        let body
        try {
          body = JSON.parse(text)
        } catch {
          return send(res, 400, { code: 'INVALID_JSON' })
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return send(res, 400, { code: 'INVALID_LOCATION' })
        const { lat, lon } = body
        if (!validNumber(lat) || !validNumber(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
          return send(res, 400, { code: 'INVALID_LOCATION' })
        const client = clients.get(ip) || { count: 0, resetAt: now() + 3600_000 }
        if (client.count >= 12 || sessions.size >= 50) return send(res, 429, { code: 'RATE_LIMIT' })
        if ([...sessions.values()].some((session) => session.ip === ip))
          return send(res, 429, { code: 'RATE_LIMIT' })
        client.count += 1
        clients.set(ip, client)
        const duration = validNumber(body.durationMs)
          ? Math.min(WINDOW_MS, Math.max(1, body.durationMs))
          : WINDOW_MS
        const id = randomUUID()
        const session = {
          ip,
          lat,
          lon,
          expiresAt: now() + duration,
          observed: new Map(),
          detailCache: new Map(),
          lastNearby: 0,
          nearbyCache: null,
          nearbyPending: null,
          controller: new AbortController(),
          timer: null,
        }
        // The timer actively cancels external requests and erases the in-memory location.
        session.timer = setTimeout(() => removeSession(id), duration)
        session.timer.unref?.()
        sessions.set(id, session)
        return send(res, 201, {
          id,
          expiresAt: session.expiresAt,
          detailsAvailable: Boolean(apiKey),
        })
      }

      if (path.startsWith('/session/') && req.method === 'DELETE') {
        const id = path.slice('/session/'.length)
        const session = sessions.get(id)
        if (session && session.ip !== ip) return send(res, 403, { code: 'SESSION_DENIED' })
        removeSession(id)
        return send(res, 200, { stopped: true })
      }

      if (!['/nearby', '/flight'].includes(path) || req.method !== 'GET')
        return send(res, 404, { code: 'NOT_FOUND' })
      const id = url.searchParams.get('session')
      const session = sessions.get(id)
      if (!session || session.expiresAt <= now()) return send(res, 410, { code: 'SESSION_EXPIRED' })
      if (session.ip !== ip) return send(res, 403, { code: 'SESSION_DENIED' })
      const disconnect = () => {
        if (!res.writableEnded) removeSession(id)
      }
      res.once('close', disconnect)

      try {
        if (path === '/nearby') {
          if (!session.nearbyCache || now() - session.lastNearby >= 6500) {
            if (!session.nearbyPending) {
              session.nearbyPending = (async () => {
                const body = await externalJson(
                  `https://api.adsb.lol/v2/point/${session.lat}/${session.lon}/${SEARCH_RADIUS_NM}`,
                  session,
                )
                if (!Array.isArray(body.ac)) throw { status: 502, code: 'INVALID_UPSTREAM_DATA' }
                const aircraft = body.ac
                  .filter(
                    (item) =>
                      validNumber(item.lat) &&
                      validNumber(item.lon) &&
                      Math.abs(item.lat) <= 90 &&
                      Math.abs(item.lon) <= 180 &&
                      item.alt_baro !== 'ground' &&
                      (item.seen_pos == null || item.seen_pos <= 30),
                  )
                  .map((item) => ({
                    id: String(item.hex || ''),
                    callsign: normalizedCallsign(item.flight),
                    lat: item.lat,
                    lon: item.lon,
                    track: validNumber(item.track) ? ((item.track % 360) + 360) % 360 : null,
                    type: typeof item.t === 'string' ? item.t : null,
                    registration: typeof item.r === 'string' ? item.r : null,
                  }))
                  .filter((item) => item.id && distanceKm(session, item) <= SEARCH_RADIUS_KM)
                  .map((item) => ({ ...item, ...resolveAirline(item) }))
                  .sort((a, b) => distanceKm(session, a) - distanceKm(session, b))
                session.observed = new Map(
                  aircraft.filter((item) => item.callsign).map((item) => [item.callsign, item]),
                )
                session.nearbyCache = { aircraft, detailsAvailable: Boolean(apiKey) }
                session.lastNearby = now()
              })().finally(() => {
                session.nearbyPending = null
              })
            }
            await session.nearbyPending
          }
          return send(res, 200, session.nearbyCache)
        }

        const callsign = normalizedCallsign(url.searchParams.get('callsign'))
        if (!/^[A-Z0-9]{2,10}$/.test(callsign) || !session.observed.has(callsign))
          return send(res, 400, { code: 'UNOBSERVED_FLIGHT' })
        if (!apiKey) return send(res, 200, { detailsStatus: 'unavailable' })
        if (!session.detailCache.has(callsign)) {
          // Store the promise too, so concurrent requests never duplicate a paid call.
          const details = (async () => {
            reserveDetailRequest()
            const endpoint = new URL('https://airlabs.co/api/v9/flight')
            endpoint.searchParams.set('flight_icao', callsign)
            endpoint.searchParams.set('api_key', apiKey)
            const body = await externalJson(endpoint, session)
            if (body.error) {
              const message = String(body.error.message || '')
              if (/month|quota|credit/i.test(message)) throw { status: 429, code: 'QUOTA_EXCEEDED' }
              throw { status: 502, code: 'FLIGHT_DETAIL_ERROR' }
            }
            const detail = body.response
            if (!detail || !isMatchingFlight(session.observed.get(callsign), detail, now()))
              return { detailsStatus: 'unverified' }
            const code = (value) =>
              typeof value === 'string' && /^[A-Z0-9]{2,5}$/.test(value) ? value : null
            const time = (value) =>
              typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
                ? value.slice(11, 16)
                : null
            return {
              detailsStatus: 'verified',
              ...resolveAirline({
                ...session.observed.get(callsign),
                airlineIata: code(detail.airline_iata),
                airlineIcao: code(detail.airline_icao),
              }),
              type: code(detail.aircraft_icao) || session.observed.get(callsign).type,
              dep: code(detail.dep_iata),
              arr: code(detail.arr_iata),
              depTime: time(detail.dep_time),
              arrTime: time(detail.arr_time),
            }
          })()
          session.detailCache.set(callsign, details)
        }
        return send(res, 200, await session.detailCache.get(callsign))
      } finally {
        res.off('close', disconnect)
      }
    } catch (error) {
      // Never return upstream URLs, API keys, or a user's coordinates in errors.
      return send(res, error.status || 500, { code: error.code || 'INTERNAL_ERROR' })
    }
  }
}
