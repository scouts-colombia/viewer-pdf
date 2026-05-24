import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/cdn-proxy': {
        target: 'https://cdnscout.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cdn-proxy/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => id.includes('pdfjs-dist') ? 'pdfjs' : undefined,
      },
    },
    target: 'es2020',
  },
});
