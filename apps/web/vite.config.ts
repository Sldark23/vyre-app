import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // SPA servida em https://vyre.zeninhost.xyz/app/ (a landing fica na raiz)
  base: '/app/',
  resolve: {
    alias: {
      '@vyre/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3100',
      '/ws': { target: 'ws://localhost:3100', ws: true },
    },
  },
});
