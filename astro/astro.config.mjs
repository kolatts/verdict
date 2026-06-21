import { defineConfig } from 'astro/config';

export default defineConfig({
  outDir: '../docs',
  vite: {
    build: {
      emptyOutDir: true,
    },
  },
});
