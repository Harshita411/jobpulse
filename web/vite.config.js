import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  // Relative /api requests keep Redis/MongoDB credentials out of browser bundles.
  const proxy = { '/api': { target: `http://127.0.0.1:${process.env.PORT || rootEnv.PORT || 3000}`, changeOrigin: true } };
  return {
    plugins: [react()],
    server: { host: 'localhost', port: 5173, strictPort: true, proxy },
    preview: { host: 'localhost', port: 5173, strictPort: true, proxy },
  };
});
