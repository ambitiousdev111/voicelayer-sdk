import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  // ── Library build ─────────────────────────────────────────────────────────
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      outDir: 'dist',
      // Roll all declarations into a single index.d.ts for consumers
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'VoiceLayer',
      formats: ['es', 'umd', 'iife'],
      fileName: 'voicelayer',
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },

  // ── Vitest ────────────────────────────────────────────────────────────────
  test: {
    // 'happy-dom' gives us window, navigator, Blob, etc. without a real browser
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
