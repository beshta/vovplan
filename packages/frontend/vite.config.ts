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
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
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
        // Модуль чтения чертежей весит больше мегабайта и нужен единицам.
        // В предзагрузке он оказывался у всех подряд, включая тех, кто просто
        // открыл лендинг; кэшируется по факту первого использования ниже.
        globIgnores: ['**/*.wasm'],
        runtimeCaching: [
          {
            // Разбор чертежей: модуль неизменяемый (имя с хешем), поэтому
            // после первой загрузки берётся из кэша
            urlPattern: /\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vovplan-wasm',
              expiration: { maxEntries: 4, maxAgeSeconds: 90 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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
  build: {
    rollupOptions: {
      output: {
        /**
         * Разделение бандла по библиотекам. Единым файлом сборка выросла до
         * 2.15 МБ и упёрлась в лимит precache у PWA — сборка падала целиком.
         * Поднимать лимит смысла нет: гнать двухмегабайтный файл на первую
         * загрузку плохо само по себе.
         *
         * Заодно кэшируется лучше: three.js меняется куда реже нашего кода,
         * и правка интерфейса больше не заставляет пользователя качать
         * заново всю 3D-библиотеку.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Загрузчики форматов (FBX, OBJ, STL...) и экспортёр GLB грузятся по
          // требованию — только когда человек добавляет модель. Если отправить
          // их в общий чанк three, правило перебьёт ленивую загрузку, и вес
          // лягут на всех: чанк three раздувался с 854К до 1.3М.
          if (/three[\\/]examples[\\/]jsm[\\/](loaders|exporters)[\\/](?!GLTFLoader)/.test(id)) return;
          // fflate распаковывает сжатые FBX и 3MF — нужна только им. В общем
          // чанке она висела бы на всех, включая тех, кто заходит на лендинг.
          if (id.includes('fflate')) return;
          if (id.includes('three') || id.includes('@react-three')) return 'three';
          if (id.includes('react') || id.includes('scheduler')) return 'react';
          if (id.includes('leaflet')) return 'leaflet';
          return 'vendor';
        },
      },
    },
  },
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
