import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode demo` produces one self-contained HTML file with an in-browser backend
// (client/demoApi.js) so the UI can be tried without a server.
export default defineConfig(({ mode }) => ({
  root: 'client',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'demo' ? '../demo-dist' : '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: mode === 'demo' ? 3000 : 900,
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
}));
