// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

/**
 * Menu principal (2026-08-25) : liste les projets du store serveur pour
 * l'ecran de selection. DEV-LOCAL uniquement (le dev server lit le FS de la
 * meme machine que le serveur) - en prod distante, c'est un endpoint du
 * serveur Rust qui prendra le relais. Renvoie {projects:[{id, mtime}]},
 * tries du plus recent au plus ancien.
 */
function projectsEndpoint(): Plugin {
  const dir = fileURLToPath(new URL('../server/projects', import.meta.url));
  return {
    name: 'projects-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/projects', (_req, res) => {
        try {
          const projects = readdirSync(dir)
            .filter((f) => f.endsWith('.am') && !f.endsWith('.am.tmp'))
            .map((f) => {
              const id = f.slice(0, -3);
              let mtime = 0;
              try { mtime = statSync(join(dir, f)).mtimeMs; } catch { /* ignore */ }
              return { id, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ projects }));
        } catch {
          // dossier absent (aucun projet encore) = liste vide, pas une erreur
          res.setHeader('content-type', 'application/json');
          res.end('{"projects":[]}');
        }
      });
    },
  };
}

/**
 * Garde de version (2026-08-27, demande utilisateur « ca m'arrive trop
 * souvent d'ouvrir un onglet qui est une vieille version du site ») :
 * l'identite de CE processus vite. Un onglet compare la valeur vue au
 * chargement a celle du serveur courant (poll) - difference = la stack a
 * ete relancee sous lui, il se RECHARGE seul. DEV-LOCAL ; en prod, un
 * hash de build servi par le serveur Rust prendra le relais.
 */
function versionEndpoint(): Plugin {
  const serveId = `${Date.now()}-${process.pid}`;
  return {
    name: 'version-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/version', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ v: serveId }));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    wasm(),
    engineTokenEndpoint(),
    projectsEndpoint(),
    versionEndpoint(),
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
