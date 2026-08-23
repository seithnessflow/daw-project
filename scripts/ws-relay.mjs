// SPDX-License-Identifier: GPL-3.0-or-later
// 1bis phase 2 relay: the engine's ixwebsocket build has USE_TLS=OFF,
// so it cannot speak wss:// to a cloudflared tunnel. This relay listens
// in plain ws/http on 127.0.0.1 and forwards EVERYTHING (WS sync + HTTP
// assets) to the https tunnel. Run it on the REMOTE machine; the local
// engine and web then use ws://localhost:<port> unchanged.
//
// Usage: node scripts/ws-relay.mjs https://<xxx>.trycloudflare.com [port=3000]
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require2 = createRequire(join(here, '..', 'web', 'package.json'));
const { WebSocket, WebSocketServer } = require2('ws');

const target = process.argv[2];
const port = Number(process.argv[3] ?? 3000);
if (!target || !/^https:\/\//.test(target)) {
  console.error('usage: node scripts/ws-relay.mjs https://<tunnel-host> [port]');
  process.exit(2);
}
const targetHost = new URL(target).host;

const server = createServer((req, res) => {
  const up = httpsRequest(
    { host: targetHost, port: 443, path: req.url, method: req.method,
      headers: { ...req.headers, host: targetHost } },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
  );
  up.on('error', (e) => { res.statusCode = 502; res.end('relay: ' + e.message); });
  req.pipe(up);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const remote = new WebSocket(`wss://${targetHost}${req.url}`);
  remote.on('open', () => {
    wss.handleUpgrade(req, socket, head, (local) => {
      local.on('message', (d, isBinary) => remote.send(d, { binary: isBinary }));
      remote.on('message', (d, isBinary) => local.send(d, { binary: isBinary }));
      const closeBoth = () => { try { local.close(); } catch {} try { remote.close(); } catch {} };
      local.on('close', closeBoth); remote.on('close', closeBoth);
      local.on('error', closeBoth); remote.on('error', closeBoth);
    });
  });
  remote.on('error', (e) => {
    console.error('relay ws error:', e.message);
    try { socket.destroy(); } catch {}
  });
});

server.listen(port, '127.0.0.1', () =>
  console.log(`relay: ws/http on 127.0.0.1:${port} -> ${target}`));
