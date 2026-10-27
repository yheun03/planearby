import dataset from '../assets/data/airlines.json' with { type: 'json' }
import domesticDataset from '../assets/data/airlines-kr.json' with { type: 'json' }

const normalize = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : ''
const code = (value, pattern) => (pattern.test(normalize(value)) ? normalize(value) : null)

export function createAirlineResolver(airlines, preferredAirlines = []) {
  const preferredIata = new Set(preferredAirlines.map((airline) => airline.iata).filter(Boolean))
  const preferredIcao = new Set(preferredAirlines.map((airline) => airline.icao).filter(Boolean))
  const entries = [
    ...preferredAirlines,
    ...airlines.filter(
      (airline) => !preferredIata.has(airline.iata) && !preferredIcao.has(airline.icao),
    ),
  ]
  const byIata = new Map()
  const byIcao = new Map()
  for (const airline of entries) {
    if (airline.iata) byIata.set(airline.iata, [...(byIata.get(airline.iata) || []), airline])
    if (airline.icao) byIcao.set(airline.icao, [...(byIcao.get(airline.icao) || []), airline])
  }

  const unique = (entries = [], icao = null) => {
    if (icao) {
      const exact = entries.filter((airline) => airline.icao === icao)
      if (exact.length === 1) return exact[0]
    }
    return entries.length === 1 ? entries[0] : null
  }
  const display = (airline, source, fallbackIata = null, fallbackIcao = null) => ({
    airlineCode: airline?.iata || fallbackIata,
    airlineName: airline?.name || null,
    ...(airline?.nameKo ? { airlineNameKo: airline.nameKo } : {}),
    airlineIcao: airline?.icao || fallbackIcao,
    airlineSource: source,
  })

  return ({ callsign, registration, airlineIata, airlineIcao } = {}) => {
    const flight = normalize(callsign)
    const callsignIcao = /^([A-Z]{3})\d[A-Z0-9]*$/.exec(flight)?.[1] || null
    const apiIata = code(airlineIata, /^[A-Z0-9]{2}$/)
    const apiIcao = code(airlineIcao, /^[A-Z]{3}$/)

    // A verified API identity takes precedence, including codes missing from the dataset.
    if (apiIata) {
      const airline = unique(byIata.get(apiIata), apiIcao || callsignIcao)
      return display(airline, 'api', apiIata, apiIcao)
    }
    if (apiIcao) return display(unique(byIcao.get(apiIcao)), 'api', null, apiIcao)

    // An ADS-B callsign can be the registration itself, rather than a flight number.
    if (
      registration &&
      flight.replaceAll('-', '') === normalize(registration).replaceAll('-', '')
    ) {
      return display(null, null)
    }
    if (callsignIcao) {
      const airline = unique(byIcao.get(callsignIcao))
      return display(airline, airline ? 'callsign' : null)
    }

    const callsignIata = /^([A-Z0-9]{2})\d[A-Z0-9]*$/.exec(flight)?.[1]
    const airline =
      callsignIata && /[A-Z]/.test(callsignIata) ? unique(byIata.get(callsignIata)) : null
    return display(airline, airline ? 'callsign' : null)
  }
}

export const resolveAirline = createAirlineResolver(dataset.airlines, domesticDataset.airlines)

export function formatFlightNumber({ callsign, registration } = {}) {
  const flight = normalize(callsign)
  if (registration && flight.replaceAll('-', '') === normalize(registration).replaceAll('-', ''))
    return flight
  const match = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})$/.exec(flight)
  if (!match || !/[A-Z]/.test(match[1])) return flight
  const prefix =
    match[1].length === 3
      ? match[1]
      : resolveAirline({ callsign: flight, registration }).airlineIcao || match[1]
  return `${prefix} ${match[2].padStart(4, '0')}`
}
