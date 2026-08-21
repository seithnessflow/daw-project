// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [
    wasm(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    // Exclude automerge from pre-bundling to avoid WASM issues
    exclude: ['@automerge/automerge'],
  },
});
