import test from 'node:test'
import assert from 'node:assert/strict'
import { aircraftModels, isSupportedAircraft } from '../utils/aircraft.js'

test('the external type dataset allows Airbus, Boeing and Bombardier aircraft', () => {
  for (const type of [
    'A320',
    'A21N',
    'A359',
    'BCS3',
    'B738',
    'B38M',
    'B789',
    'CRJ9',
    'DH8D',
    'CL60',
  ])
    assert.equal(isSupportedAircraft({ type }), true, type)
  assert.equal(aircraftModels.B738, 'Boeing 737-800')
  assert.equal(isSupportedAircraft({ type: ' b738 ' }), true)
})

test('GLEX, helicopters, other manufacturers and unknown types are excluded', () => {
  for (const type of ['GLEX', 'H160', 'B06', 'EC45', 'E190', 'AT76', 'C172', 'ZZZZ', null, ''])
    assert.equal(isSupportedAircraft({ type }), false, String(type))
  assert.equal(isSupportedAircraft({ type: 'A320', category: 'A7' }), false)
})
