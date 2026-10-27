import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { createApiHandler } from './api/aircraft.js'

if (existsSync('.env')) process.loadEnvFile('.env')
const api = createApiHandler()
const root = resolve('dist')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), camera=(), microphone=()',
  )
  const path = new URL(req.url, 'http://localhost').pathname
  if (path.startsWith('/api/')) return api(req, res)
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405)
    return res.end()
  }
  try {
    const file =
      path === '/' ? resolve(root, 'index.html') : resolve(root, `.${decodeURIComponent(path)}`)
    if (!file.startsWith(`${root}${sep}`)) {
      res.writeHead(403)
      return res.end()
    }
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
    res.setHeader(
      'Cache-Control',
      path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
    res.writeHead(200)
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
})

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () =>
  console.log(`Planearby: http://127.0.0.1:${server.address().port}`),
)
