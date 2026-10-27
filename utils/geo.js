const radians = (degrees) => (degrees * Math.PI) / 180

export const SEARCH_RADIUS_KM = 25
// adsb.lol accepts nautical miles. Round up, then filter to the exact km radius.
export const SEARCH_RADIUS_NM = Math.ceil(SEARCH_RADIUS_KM / 1.852)

export const normalizeDegrees = (value) => ((value % 360) + 360) % 360

export const relativeBearing = (bearing, heading) => normalizeDegrees(bearing - heading)

// Phone held screen-up: Safari provides magnetic heading; absolute alpha is
// earth-referenced on supporting browsers. Relative-only alpha is not a compass.
export function compassHeading(event, screenAngle = 0) {
  if (Number.isFinite(event.webkitCompassHeading)) {
    if (
      Number.isFinite(event.webkitCompassAccuracy) &&
      (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 45)
    )
      return null
    return normalizeDegrees(event.webkitCompassHeading + screenAngle)
  }
  if (
    (event.absolute || event.type === 'deviceorientationabsolute') &&
    Number.isFinite(event.alpha)
  ) {
    return normalizeDegrees(360 - event.alpha + screenAngle)
  }
  return null
}

// Horizontal great-circle distance. Aircraft altitude is deliberately excluded.
export function distanceKm(from, to) {
  const latitude = radians(to.lat - from.lat)
  const longitude = radians(to.lon - from.lon)
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(longitude / 2) ** 2
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))))
}

// Initial bearing clockwise from true north.
export function bearingDegrees(from, to) {
  const longitude = radians(to.lon - from.lon)
  const y = Math.sin(longitude) * Math.cos(radians(to.lat))
  const x =
    Math.cos(radians(from.lat)) * Math.sin(radians(to.lat)) -
    Math.sin(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.cos(longitude)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
