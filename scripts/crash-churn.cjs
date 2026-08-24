// Repro 0xe06d7363, axe A : churn de clients WS sur le serveur du
// MOTEUR (jetable, port 47831). 3 variantes de fermeture par cycle :
// propre / brutale post-auth / brutale en plein flux de tap.
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('C:/Users/mb668/daw-project/web/node_modules/ws');

const PORT = 47831;
const tokenFile = path.join(os.tmpdir(), `daw-engine-token-${PORT}`);
const token = JSON.parse(fs.readFileSync(tokenFile, 'utf8')).token;

// Message{tap_control{enabled:true}} : champ 7 LEN 2 [08 01], prefixe BE
const TAP_ON = Buffer.from([0, 0, 0, 4, 0x3a, 2, 8, 1]);

function cycle(variant) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    let frames = 0;
    const done = (tag) => { resolve(tag); };
    ws.on('open', () => {
      ws.send(Buffer.concat([Buffer.from([0]), Buffer.from(token)]));
      if (variant === 0) {
        setTimeout(() => { ws.close(); done('clean'); }, 120);
      } else if (variant === 1) {
        setTimeout(() => { ws.terminate(); done('abort-post-auth'); }, 60);
      } else {
        ws.send(TAP_ON);
        ws.on('message', () => {
          if (++frames >= 5) { ws.terminate(); done('abort-mid-tap'); }
        });
        setTimeout(() => { ws.terminate(); done('abort-tap-timeout'); }, 1500);
      }
    });
    ws.on('error', () => done('conn-error'));
    setTimeout(() => { try { ws.terminate(); } catch {} ; done('cycle-timeout'); }, 4000);
  });
}

(async () => {
  for (let i = 0; i < 60; i++) {
    const tag = await cycle(i % 3);
    if (i % 10 === 9) console.log(`cycle ${i + 1}/60 (${tag})`);
    await new Promise((r) => setTimeout(r, 80));
  }
  console.log('60 cycles termines sans blocage cote harnais');
})();
