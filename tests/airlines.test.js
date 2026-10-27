import test from 'node:test'
import assert from 'node:assert/strict'
import { createAirlineResolver, resolveAirline } from '../utils/airlines.js'

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
