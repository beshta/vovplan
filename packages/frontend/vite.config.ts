import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // SW только в проде: в dev он мешает HMR и кэширует лишнее
      devOptions: { enabled: false },
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'VOVPLAN — 3D платформа проектов',
        short_name: 'VOVPLAN',
        description: 'Совместный 3D-просмотр территориальных проектов',
        lang: 'ru',
        theme_color: '#0b1020',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Шелл приложения — precache; API и сокет не трогаем
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/uploads\//],
        runtimeCaching: [
          {
            // 3D-ассеты (GLB, heightmap) — тяжёлые и неизменяемые: CacheFirst
            urlPattern: /^\/uploads\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vovplan-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // API-чтение — NetworkFirst: свежие данные, офлайн-фолбэк из кэша
            urlPattern: /^\/api\/(projects|shared)\/.*/i,
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'vovplan-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // Read .env from the monorepo root (default would be packages/frontend)
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    host: true, // listen on all interfaces (IPv4 + IPv6) — enables LAN/mobile testing
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Загруженные файлы (heightmap/текстуры/GLB) раздаёт бэкенд
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Socket.io (real-time) — proxied with WebSocket upgrade so the client
      // stays same-origin regardless of whether VITE_API_URL is set.
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
