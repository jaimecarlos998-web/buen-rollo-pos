import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/buen-rollo-pos/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Buen Rollo · Punto de venta',
        short_name: 'Buen Rollo',
        description: 'Ventas, stock y compras de Buen Rollo',
        lang: 'es-AR',
        theme_color: '#0f766e',
        background_color: '#f6f5f1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/buen-rollo-pos/',
        scope: '/buen-rollo-pos/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/buen-rollo-pos/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 },
})
