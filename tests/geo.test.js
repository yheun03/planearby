import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bearingDegrees,
  compassHeading,
  distanceKm,
  normalizeDegrees,
  relativeBearing,
  SEARCH_RADIUS_KM,
  SEARCH_RADIUS_NM,
} from '../shared/geo.js'

test('the nautical-mile request covers the 50 km radius without requesting an extra mile', () => {
  assert.equal(SEARCH_RADIUS_KM, 50)
  assert.equal(SEARCH_RADIUS_NM, 27)
  assert.ok(SEARCH_RADIUS_NM * 1.852 >= SEARCH_RADIUS_KM)
  assert.ok((SEARCH_RADIUS_NM - 1) * 1.852 < SEARCH_RADIUS_KM)
})

test('distance is zero for identical coordinates and ignores altitude', () => {
  assert.equal(
    distanceKm({ lat: 37, lon: 127, altitude: 0 }, { lat: 37, lon: 127, altitude: 10000 }),
    0,
  )
})

test('one degree of latitude is about 111.2 km', () => {
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111.195) < 0.001)
})

test('distance handles the date line and antipodal coordinates', () => {
  assert.ok(distanceKm({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 }) < 0.3)
  assert.ok(Number.isFinite(distanceKm({ lat: 90, lon: 0 }, { lat: -90, lon: 180 })))
})

test('radar bearings are measured clockwise from true north', () => {
  const center = { lat: 0, lon: 0 }
  assert.equal(bearingDegrees(center, { lat: 1, lon: 0 }), 0)
  assert.equal(bearingDegrees(center, { lat: 0, lon: 1 }), 90)
  assert.equal(bearingDegrees(center, { lat: -1, lon: 0 }), 180)
  assert.equal(bearingDegrees(center, { lat: 0, lon: -1 }), 270)
})

test('heading angles wrap correctly at north', () => {
  assert.equal(normalizeDegrees(-1), 359)
  assert.equal(normalizeDegrees(361), 1)
  assert.equal(relativeBearing(1, 359), 2)
  assert.equal(relativeBearing(359, 1), 358)
})

test('facing east moves north to the left and an eastbound aircraft to the top', () => {
  assert.equal(relativeBearing(0, 90), 270)
  assert.equal(relativeBearing(90, 90), 0)
  assert.equal(relativeBearing(52, 90), 322)
})

test('absolute device orientation supplies a compass heading and accounts for screen rotation', () => {
  assert.equal(compassHeading({ absolute: true, alpha: 270 }), 90)
  assert.equal(compassHeading({ type: 'deviceorientationabsolute', alpha: 270 }, 90), 180)
  assert.equal(compassHeading({ absolute: true, alpha: 360 }), 0)
})

test('relative orientation alone must not be presented as north-referenced', () => {
  assert.equal(compassHeading({ absolute: false, alpha: 90 }), null)
  assert.equal(compassHeading({ absolute: true, alpha: null }), null)
})

test('Safari compass readings require usable calibration', () => {
  assert.equal(compassHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: 10 }), 90)
  assert.equal(compassHeading({ webkitCompassHeading: 350, webkitCompassAccuracy: 10 }, 90), 80)
  assert.equal(compassHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: -1 }), null)
  assert.equal(compassHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: 60 }), null)
})
