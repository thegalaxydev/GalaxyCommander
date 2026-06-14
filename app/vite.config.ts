import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
