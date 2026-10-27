import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import vue from '@vitejs/plugin-vue'
import { githubPagesTarget } from './utils/deployment.js'
import { projectConfig } from './project.config.js'
import aircraftApi from './api/aircraft.js'

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  )

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  let pages
  try {
    pages = githubPagesTarget(
      execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }),
    )
  } catch {
    /* A local checkout can run without a remote. */
  }
  if (mode === 'pages' && !pages)
    throw new Error('GitHub origin remote is required for Pages deployment')
  const base = mode === 'pages' ? pages.base : projectConfig.baseURL
  const configuredUrl = env.SITE_URL || projectConfig.siteUrl || (mode === 'pages' ? pages.url : '')
  const siteUrl = configuredUrl ? `${configuredUrl.replace(/\/+$/, '')}/` : ''

  return {
    base,
    define: {
      'import.meta.env.VITE_PAGES_PREVIEW_ONLY': JSON.stringify(
        mode === 'pages' && !env.VITE_AIRCRAFT_API_URL?.trim(),
      ),
    },
    resolve: { alias: { '~': fileURLToPath(new URL('.', import.meta.url)) } },
    plugins: [
      vue(),
      {
        name: 'local-aircraft-api',
        configureServer(server) {
          server.middlewares.use('/api/aircraft', aircraftApi)
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/aircraft', aircraftApi)
        },
      },
      {
        name: 'project-metadata',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            const values = {
              PROJECT_NAME: projectConfig.serviceName,
              PROJECT_TITLE: projectConfig.seo.title,
              PROJECT_DESCRIPTION: projectConfig.seo.description,
              PROJECT_THEME_COLOR: projectConfig.themeColor,
              PROJECT_FAVICON: `${base}${projectConfig.favicon}`,
              PROJECT_OG_IMAGE: siteUrl
                ? new URL(projectConfig.seo.ogImage, siteUrl).href
                : `${base}${projectConfig.seo.ogImage}`,
              PROJECT_TWITTER_CARD: projectConfig.seo.twitterCard,
            }
            const schema = {
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: projectConfig.serviceName,
              description: projectConfig.seo.description,
              applicationCategory: 'TravelApplication',
              operatingSystem: 'Any',
              inLanguage: ['ko', 'en', 'ja'],
              isAccessibleForFree: true,
              ...(siteUrl ? { url: siteUrl } : {}),
              browserRequirements: 'JavaScript and geolocation permission; HTTPS or localhost',
            }
            return html
              .replace(
                '<!--project-canonical-->',
                siteUrl
                  ? `<link rel="canonical" href="${escapeHtml(siteUrl)}"><meta property="og:url" content="${escapeHtml(siteUrl)}">`
                  : '',
              )
              .replace(/%([A-Z_]+)%/g, (placeholder, key) =>
                key in values ? escapeHtml(values[key]) : placeholder,
              )
              .replace(
                '<!--project-schema-->',
                `<script type="application/ld+json" id="app-schema">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`,
              )
          },
        },
      },
      {
        name: 'search-engine-files',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'robots.txt',
            source: `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${new URL('sitemap.xml', siteUrl).href}\n` : ''}`,
          })
          if (siteUrl)
            this.emitFile({
              type: 'asset',
              fileName: 'sitemap.xml',
              source: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(siteUrl)}</loc></url></urlset>`,
            })
        },
      },
    ],
  }
})
