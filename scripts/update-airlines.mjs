import { createHash } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { projectConfig } from '../project.config.js'

const source = projectConfig.airlineData
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Planearby-airline-data (+https://github.com/yheun03/planearby)',
}

async function download(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Airline data download failed: HTTP ${response.status}`)
  return response
}

const commitsUrl = new URL(`https://api.github.com/repos/${source.repository}/commits`)
commitsUrl.searchParams.set('path', source.path)
commitsUrl.searchParams.set('per_page', '1')
const commits = await (await download(commitsUrl)).json()
const revision = commits[0]?.sha
if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Invalid dataset revision')

const dataUrl = `https://raw.githubusercontent.com/${source.repository}/${revision}/${source.path}`
const csv = await (await download(dataUrl)).text()
const rows = parse(csv, { skip_empty_lines: true, bom: true })
const unique = new Map()

for (const row of rows) {
  const name = String(row[1] || '').trim()
  const iata = /^[A-Z0-9]{2}$/.test(row[3]) ? row[3] : null
  const icao = /^[A-Z]{3}$/.test(row[4]) ? row[4] : null
  if (row[7] !== 'Y' || !name || name === '\\N' || (!iata && !icao)) continue
  const airline = { name, iata, icao }
  unique.set(JSON.stringify(airline), airline)
}

const airlines = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
if (airlines.length < 100) throw new Error('Dataset is unexpectedly small; existing data was kept')

const dataset = {
  source: {
    name: source.name,
    url: source.sourceUrl,
    dataUrl,
    revision,
    retrievedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(csv).digest('hex'),
    license: source.license,
    licenseUrl: source.licenseUrl,
    filter: 'Active=Y; valid IATA or ICAO code; exact duplicate rows removed',
  },
  airlines,
}

// Generate current domestic identities from the public official directory, not a handwritten map.
const domesticSource = projectConfig.domesticAirlineData
const domesticText = await (
  await download(domesticSource.apiUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json;charset=UTF-8',
      'request-call': 'web-rest',
    },
    body: JSON.stringify(domesticSource.query),
  })
).text()
const domesticResponse = JSON.parse(domesticText)
if (
  !Array.isArray(domesticResponse.content) ||
  domesticResponse.total > domesticResponse.content.length
)
  throw new Error('Incomplete domestic airline directory; existing snapshots were kept')
const domesticAirlines = domesticResponse.content
  .filter((row) => row.en2Country === domesticSource.query.searchName && row.section === '운영중')
  .map((row) => ({
    name: String(row.name || '').trim(),
    nameKo: String(row.name2 || '').trim(),
    iata: /^[A-Z0-9]{2}$/.test(row.iataCode) ? row.iataCode : null,
    icao: /^[A-Z]{3}$/.test(row.icaoCode) ? row.icaoCode : null,
  }))
  .filter((airline) => airline.name && airline.nameKo && airline.iata && airline.icao)
if (domesticAirlines.length < 5) throw new Error('Domestic airline directory is unexpectedly small')
const domesticDataset = {
  source: {
    name: domesticSource.name,
    url: domesticSource.sourceUrl,
    apiUrl: domesticSource.apiUrl,
    query: domesticSource.query,
    retrievedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(domesticText).digest('hex'),
    filter:
      'Operating airlines in Republic of Korea; factual names and valid IATA/ICAO identifiers only',
    attribution:
      '항공정보포털 · 국토교통부 / 한국항공협회. Original website terms apply; no license is asserted for the original directory.',
  },
  airlines: domesticAirlines,
}

const directory = new URL('../assets/data/', import.meta.url)
await mkdir(directory, { recursive: true })
const file = new URL('airlines.json', directory)
await writeFile(new URL('airlines.json.tmp', directory), `${JSON.stringify(dataset, null, 2)}\n`)
await rename(new URL('airlines.json.tmp', directory), file)
const domesticFile = new URL('airlines-kr.json', directory)
await writeFile(
  new URL('airlines-kr.json.tmp', directory),
  `${JSON.stringify(domesticDataset, null, 2)}\n`,
)
await rename(new URL('airlines-kr.json.tmp', directory), domesticFile)
console.log(`Updated ${airlines.length} airlines: ${fileURLToPath(file)}`)
console.log(`Updated ${domesticAirlines.length} domestic airlines: ${fileURLToPath(domesticFile)}`)
console.log(`Source revision: ${revision}`)
