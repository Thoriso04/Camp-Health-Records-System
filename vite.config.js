import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Electron loads the built app via file://, so paths must be relative (base: './').
// outDir is set to 'build' to match electron/main.js's fallback:
//   file://${path.join(__dirname, '../build/index.html')}
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});