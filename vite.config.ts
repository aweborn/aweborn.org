import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@aweborn/shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        // Print-size World Index art for card print files (scripts/cards/build-batch.mjs)
        cardArt: path.resolve(__dirname, 'card-art.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://1cyz3xulg5.execute-api.us-east-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})

