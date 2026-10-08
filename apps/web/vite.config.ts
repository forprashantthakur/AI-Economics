import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` produces one self-contained index.html (used for the hosted demo).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 6000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
}));
