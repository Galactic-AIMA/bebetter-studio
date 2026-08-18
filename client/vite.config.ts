import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // El wrap y la división por tiempos son código compartido con el servidor.
      // Viven bajo `server/src/text` porque el `tsc` del servidor compila con
      // `rootDir: src` y no puede sacar archivos de ahí; Vite, en cambio, empaqueta
      // desde donde sea. Solo se comparte lo que no toca ni Node ni el DOM.
      '@shared': path.resolve(__dirname, '../server/src/text'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/output': 'http://localhost:3001',
    },
  },
})
