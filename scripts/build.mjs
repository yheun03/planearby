import { build, createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { readFile, writeFile } from 'node:fs/promises'

await build()
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
})
try {
  const { default: App } = await server.ssrLoadModule('/app.vue')
  const html = await renderToString(createSSRApp(App))
  const document = await readFile('dist/index.html', 'utf8')
  await writeFile('dist/index.html', document.replace('<!--app-html-->', html))
  console.log('Prerendered dashboard: dist/index.html')
} finally {
  await server.close()
}
