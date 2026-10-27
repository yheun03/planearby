import test from 'node:test'
import assert from 'node:assert/strict'
import { createAirlineResolver, formatFlightNumber, resolveAirline } from '../utils/airlines.js'

const airlines = [
  { name: 'Example Alpha', iata: 'ZX', icao: 'XAA' },
  { name: 'Example Beta', iata: '7Q', icao: 'XBB' },
  { name: 'Shared Code One', iata: 'D4', icao: 'DUP' },
  { name: 'Shared Code Two', iata: 'D4', icao: 'ALT' },
  { name: 'ICAO Only', iata: null, icao: 'NON' },
]
const resolve = createAirlineResolver(airlines)

test('ICAO callsigns resolve to the external airline name and IATA code', () => {
  assert.deepEqual(resolve({ callsign: ' xaa 123 ' }), {
    airlineCode: 'ZX',
    airlineName: 'Example Alpha',
    airlineIcao: 'XAA',
    airlineSource: 'callsign',
  })
})

test('IATA flight numbers support alphanumeric airline designators', () => {
  assert.equal(resolve({ callsign: 'ZX123' }).airlineName, 'Example Alpha')
  assert.equal(resolve({ callsign: '7Q123' }).airlineName, 'Example Beta')
})

test('verified API codes take precedence over a callsign inference', () => {
  assert.deepEqual(resolve({ callsign: 'XAA123', airlineIata: '7Q' }), {
    airlineCode: '7Q',
    airlineName: 'Example Beta',
    airlineIcao: 'XBB',
    airlineSource: 'api',
  })
  assert.equal(resolve({ callsign: 'XAA123', airlineIcao: 'XBB' }).airlineCode, '7Q')
})

test('unknown API codes remain codes instead of being replaced with an inferred airline', () => {
  const result = resolve({ callsign: 'XAA123', airlineIata: 'Z9' })
  assert.equal(result.airlineCode, 'Z9')
  assert.equal(result.airlineName, null)
  assert.equal(result.airlineSource, 'api')
})

test('ambiguous IATA codes require an ICAO identity to select a name', () => {
  assert.equal(resolve({ callsign: 'D4123' }).airlineName, null)
  assert.equal(resolve({ airlineIata: 'D4' }).airlineName, null)
  assert.equal(resolve({ airlineIata: 'D4', callsign: 'ALT123' }).airlineName, 'Shared Code Two')
})

test('ambiguous ICAO codes and registration-only callsigns are not guessed', () => {
  const ambiguous = createAirlineResolver([
    ...airlines,
    { name: 'Another Alpha', iata: 'Y8', icao: 'XAA' },
  ])
  assert.equal(ambiguous({ callsign: 'XAA123' }).airlineName, null)
  assert.equal(resolve({ callsign: 'XAA123', registration: 'XAA-123' }).airlineName, null)
  assert.equal(resolve({ callsign: 'XAA' }).airlineName, null)
  assert.equal(resolve({ callsign: 'UNKNOWN' }).airlineName, null)
})

test('an airline without an IATA code never receives an invented code', () => {
  const result = resolve({ callsign: 'NON123' })
  assert.equal(result.airlineName, 'ICAO Only')
  assert.equal(result.airlineCode, null)
})

test('the generated external dataset covers the displayed Korean callsigns', () => {
  assert.equal(resolveAirline({ callsign: 'KAL1428' }).airlineCode, 'KE')
  assert.equal(resolveAirline({ callsign: 'AAR102' }).airlineCode, 'OZ')
  assert.equal(resolveAirline({ callsign: 'JJA1301' }).airlineCode, '7C')
  assert.equal(resolveAirline({ callsign: 'TWB281' }).airlineCode, 'TW')
})

test('the official domestic snapshot resolves new LCCs and reused IATA codes', () => {
  for (const [icao, iata, nameKo] of [
    ['PTA', 'WE', '파라타항공'],
    ['ASV', 'RS', '에어서울'],
    ['EOK', 'RF', '에어로K'],
    ['APZ', 'YP', '에어프레미아'],
  ]) {
    for (const callsign of [`${icao}123`, `${iata}123`]) {
      const airline = resolveAirline({ callsign })
      assert.equal(airline.airlineIcao, icao)
      assert.equal(airline.airlineCode, iata)
      assert.equal(airline.airlineNameKo, nameKo)
      assert.equal(formatFlightNumber({ callsign }), `${icao} 0123`)
    }
  }
})

test('preferred directory identities replace stale codes without guessing an old ICAO operator', () => {
  const current = createAirlineResolver(
    [
      { name: 'Former Operator', iata: 'RS', icao: 'OLD' },
      { name: 'Reused ICAO Operator', iata: null, icao: 'ASV' },
    ],
    [{ name: 'Air Seoul', nameKo: '에어서울', iata: 'RS', icao: 'ASV' }],
  )
  assert.equal(current({ callsign: 'RS123' }).airlineName, 'Air Seoul')
  assert.equal(current({ callsign: 'ASV123' }).airlineNameKo, '에어서울')
  assert.equal(current({ callsign: 'OLD123' }).airlineName, null)
})

test('displayed flight numbers use dataset ICAO prefixes and four numeric digits', () => {
  for (const [callsign, display] of [
    ['oz123', 'AAR 0123'],
    [' AAR 123 ', 'AAR 0123'],
    ['KE7', 'KAL 0007'],
    ['KAL0007', 'KAL 0007'],
    ['7C123', 'JJA 0123'],
    ['JJA9999', 'JJA 9999'],
    ['ZZ123', 'ZZ 0123'],
  ])
    assert.equal(formatFlightNumber({ callsign }), display)
})

test('display formatting preserves registrations and nonnumeric or oversized callsigns without truncation', () => {
  for (const callsign of ['KAL12A', 'KAL12345', '12345', 'UNKNOWN'])
    assert.equal(formatFlightNumber({ callsign }), callsign)
  assert.equal(formatFlightNumber({ callsign: 'AAR123', registration: 'AAR-123' }), 'AAR123')
  assert.equal(formatFlightNumber(), '')
  const flight = { callsign: 'OZ123' }
  assert.equal(formatFlightNumber(flight), 'AAR 0123')
  assert.equal(flight.callsign, 'OZ123', 'API queries must retain the original callsign')
})
