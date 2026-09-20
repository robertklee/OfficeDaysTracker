import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'RTO Planner',
        short_name: 'RTO Planner',
        description: 'Private attendance tracking and explainable office planning.',
        start_url: '/dashboard',
        scope: '/',
        display: 'standalone',
        theme_color: '#172b43',
        background_color: '#f4f6f9',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
  preview: { proxy: {} },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'civil-dates': ['@js-temporal/polyfill'],
          'local-data': ['dexie', 'zod'],
        },
      },
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
