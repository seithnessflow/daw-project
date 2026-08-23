// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 1pre - zero-paste token delivery (dev stage). The dev server CAN read
 * %TEMP% (same machine as the engine); the page cannot. A drive-by page
 * cannot READ the response (no CORS headers) and LNA gates it further.
 * The remote-site mechanism (engine-served, Origin-gated, or fragment
 * launch) is the production follow-up recorded in ADR-019 / TODO 1pre.
 */
function engineTokenEndpoint(): Plugin {
  return {
    name: 'engine-token-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/engine-token', (req, res) => {
        const port =
          new URL(req.url ?? '/', 'http://localhost').searchParams.get('port') ?? '47821';
        if (!/^\d{2,5}$/.test(port)) {
          res.statusCode = 400;
          res.end('{"error":"bad port"}');
          return;
        }
        try {
          const raw = readFileSync(join(tmpdir(), `daw-engine-token-${port}`), 'utf8');
          res.setHeader('content-type', 'application/json');
          res.end(raw);
        } catch {
          res.statusCode = 404;
          res.end('{"error":"no engine token"}');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    wasm(),
    engineTokenEndpoint(),
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
