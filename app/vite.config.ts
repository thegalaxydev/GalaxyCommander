import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8')
)

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    proxy: {
      '/edhrec-api': {
        target: 'https://json.edhrec.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/edhrec-api/, ''),
      },
    },
  },
})
