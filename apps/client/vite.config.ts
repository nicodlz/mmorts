import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_SERVER_URL || 'http://localhost:2567',
        changeOrigin: true,
      },
      '/colyseus': {
        target: process.env.VITE_SERVER_URL || 'ws://localhost:2567',
        ws: true,
      },
    },
  },
  publicDir: 'public',
  base: '/',
}); 