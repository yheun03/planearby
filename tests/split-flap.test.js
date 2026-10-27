import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

const source = new URL('../components/projects/planearby/PlanearbySplitFlap.vue', import.meta.url)
const { descriptor } = parse(await readFile(source, 'utf8'))
const compiled = compileScript(descriptor, { id: 'split-flap-test', inlineTemplate: true }).content
const file = new URL('../.data/split-flap-test.mjs', import.meta.url)
await mkdir(new URL('../.data/', import.meta.url), { recursive: true })
await writeFile(file, compiled)
after(() => rm(file, { force: true }))
const { default: SplitFlap } = await import(file.href)

test('spaces separate flight-number groups without an empty tile or seam', async () => {
  const html = await renderToString(createSSRApp(SplitFlap, { text: 'ASV 0123' }))
  assert.equal((html.match(/class="split-flap__cell"/g) || []).length, 7)
  assert.equal((html.match(/class="split-flap__seam"/g) || []).length, 7)
  assert.equal((html.match(/class="split-flap__space"/g) || []).length, 1)
  assert.match(html, /aria-label="ASV 0123"/)
})

test('numeric displays keep every digit and do not add a group separator', async () => {
  const html = await renderToString(createSSRApp(SplitFlap, { text: '0123' }))
  assert.equal((html.match(/class="split-flap__cell"/g) || []).length, 4)
  assert.equal(html.includes('split-flap__space'), false)
})
