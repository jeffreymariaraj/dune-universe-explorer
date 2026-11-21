import { defineConfig } from 'vitest/config';
import glsl from 'vite-plugin-glsl';

// Unit I: build pipeline. GLSL lives in src/shaders/*.glsl and is imported as a
// string by vite-plugin-glsl, so shaders stay in real .glsl files (with #include
// support) instead of template literals.
export default defineConfig({
  // minify: false keeps shader source readable in the browser's
  // Sources panel, which matters when debugging GLSL in the viva.
  plugins: [glsl({ minify: false })],
  server: {
    port: 5173,
    proxy: {
      // The Mentat proxy holds the LLM key; the browser only ever talks to /api.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    // Physics is pure functions, so the default node environment is enough.
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
