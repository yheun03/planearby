import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createApiHandler } from './server/api.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
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
