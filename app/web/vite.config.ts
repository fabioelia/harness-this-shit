import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5317,
    strictPort: true,
    host: true,
    proxy: { '/api': 'http://localhost:4317' },
  },
});
