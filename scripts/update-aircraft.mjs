import { createHash } from 'node:crypto'
import { writeFile, rename } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import { projectConfig } from '../project.config.js'

const source = projectConfig.airlineData
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Planearby-flight-data (+https://github.com/yheun03/planearby)',
}

async function download(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Flight data download failed: HTTP ${response.status}`)
  return response
}

async function update(name, transform, minimum) {
  const path = `data/${name}.dat`
  const url = new URL(`https://api.github.com/repos/${source.repository}/commits`)
  url.searchParams.set('path', path)
  url.searchParams.set('per_page', '1')
  const commits = await (await download(url)).json()
  const revision = commits[0]?.sha
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Invalid dataset revision')
  const dataUrl = `https://raw.githubusercontent.com/${source.repository}/${revision}/${path}`
  const csv = await (await download(dataUrl)).text()
  const records = transform(parse(csv, { skip_empty_lines: true, bom: true }))
  if (records.length < minimum) throw new Error(`Unexpectedly small ${name} dataset`)
  const dataset = {
    source: {
      name: source.name,
      url: 'https://openflights.org/data.php#plane',
      dataUrl,
      revision,
      retrievedAt: new Date().toISOString(),
      sha256: createHash('sha256').update(csv).digest('hex'),
      license: source.license,
      licenseUrl: source.licenseUrl,
      filter:
        'Airbus, Boeing and Bombardier families including legacy Canadair CRJ/Challenger and Dash 8; valid ICAO code; GLEX excluded',
    },
    [name]: records,
  }
  const file = new URL(`../assets/data/${name}.json`, import.meta.url)
  const temporary = new URL(`${file.href}.tmp`)
  await writeFile(temporary, `${JSON.stringify(dataset, null, 2)}\n`)
  await rename(temporary, file)
  console.log(`Updated ${records.length} ${name}: ${revision}`)
}

await update(
  'planes',
  (rows) =>
    rows.flatMap(([name, , icao]) => {
      // Canadair CRJ and Dash 8 retain their source names from the Bombardier era.
      const manufacturer =
        /^(Airbus|Boeing|Bombardier)\b/.exec(name)?.[1] ||
        (/^Canadair (Challenger|Regional Jet)\b/.test(name) || /^DH8[ABCD]$/.test(icao)
          ? 'Bombardier'
          : null)
      return manufacturer && /^[A-Z0-9]{2,4}$/.test(icao) && icao !== 'GLEX'
        ? [{ icao, name, manufacturer }]
        : []
    }),
  50,
)
