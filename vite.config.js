import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { createApiHandler } from './server/api/aircraft.js'
import { projectConfig } from './project.config.js'

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

  return {
    base: projectConfig.baseURL,
    resolve: { alias: { '~': fileURLToPath(new URL('.', import.meta.url)) } },
    plugins: [
      vue(),
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
              PROJECT_FAVICON: `${projectConfig.baseURL}${projectConfig.favicon}`,
              PROJECT_OG_IMAGE: `${projectConfig.baseURL}${projectConfig.seo.ogImage}`,
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
              browserRequirements: 'JavaScript and geolocation permission; HTTPS or localhost',
            }
            return html
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
        name: 'planearby-api',
        configureServer(server) {
          server.middlewares.use(
            '/api',
            createApiHandler({
              apiKey: env.AIRLABS_API_KEY,
              userAgent: env.ADSB_USER_AGENT,
              monthlyLimit: env.AIRLABS_MONTHLY_LIMIT,
            }),
          )
        },
      },
    ],
  }
})
