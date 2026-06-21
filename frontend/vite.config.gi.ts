import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/sr/gi-challenge/',
  root: path.resolve(__dirname, 'gi-src'),
  build: {
    outDir: path.resolve(__dirname, 'gi-dist'),
  },
})
