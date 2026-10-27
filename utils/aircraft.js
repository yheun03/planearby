import dataset from '../assets/data/planes.json' with { type: 'json' }

export const aircraftModels = Object.fromEntries(
  dataset.planes.map(({ icao, name }) => [icao, name]),
)

export function isSupportedAircraft({ type, category } = {}) {
  const code = typeof type === 'string' ? type.trim().toUpperCase() : ''
  return category !== 'A7' && code !== 'GLEX' && Object.hasOwn(aircraftModels, code)
}
