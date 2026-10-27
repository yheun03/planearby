import { resolveAirline } from '../../../../utils/airlines.js'

export const previewCenter = { lat: 37.5665, lon: 126.978 }

// Fictional observations for the explicitly labeled preview. Never mixed with live data.
export const exampleFlights = [
  {
    id: 'example-ke',
    callsign: 'KAL1428',
    type: 'B738',
    lat: 37.684456,
    lon: 127.08116,
    track: 52,
    dep: 'ICN',
    arr: 'FUK',
    depTime: '13:25',
    arrTime: '14:55',
  },
  {
    id: 'example-oz',
    callsign: 'AAR102',
    type: 'A321',
    lat: 37.465635,
    lon: 127.275107,
    track: 112,
    dep: 'ICN',
    arr: 'NRT',
    depTime: '12:40',
    arrTime: '15:10',
  },
  {
    id: 'example-7c',
    callsign: 'JJA1301',
    type: 'B738',
    lat: 37.290271,
    lon: 126.742852,
    track: 228,
    dep: 'ICN',
    arr: 'KIX',
    depTime: '13:10',
    arrTime: '15:00',
  },
  {
    id: 'example-tw',
    callsign: 'TWB281',
    type: 'B738',
    lat: 37.766206,
    lon: 126.539344,
    track: 313,
    dep: 'GMP',
    arr: 'TSA',
    depTime: '12:20',
    arrTime: '14:10',
  },
].map((flight) => ({
  ...flight,
  ...resolveAirline({ callsign: flight.callsign }),
  detailsStatus: 'example',
}))
