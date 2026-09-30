import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  envDir: '..',
  server: { host: true },
  preview: { host: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
