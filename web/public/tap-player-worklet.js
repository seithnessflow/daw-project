// SPDX-License-Identifier: GPL-3.0-or-later
// S8c - tap player: replays the engine's post-master PCM (pushed by
// the main thread from AudioTap batches) into the graph that feeds
// the outgoing WebRTC MediaStream. FIFO of interleaved stereo
// Float32Arrays; underrun = silence + counter (reported on request).
class TapPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.underruns = 0;
    // SPIKE LATENCE s2 : PRE-BUFFER d'amorcage. Les blocs arrivent en
    // rafales (cadence du callback moteur ~10,7 ms) ; demarrer a vide
    // faisait tomber le FIFO a sec entre deux rafales (238-950
    // underruns/10 s mesures = flux HACHE vers les pairs). On ne sort
    // du silence qu'a PRIME blocs en stock (4 x 256 = ~21 ms), et on
    // se re-amorce apres chaque famine. +21 ms de latence broadcaster
    // contre un flux propre - NetEq en aval en absorbe autant de toute
    // facon sur un flux hache.
    this.PRIME = 4;
    this.primed = false;
    this.port.onmessage = (e) => {
      if (e.data === 'stats?') {
        this.port.postMessage({ underruns: this.underruns, queued: this.queue.length });
        return;
      }
      this.queue.push(e.data);
      if (!this.primed && this.queue.length >= this.PRIME) this.primed = true;
      // Bound the buffer: ~50 blocks = 266 ms; beyond that we are
      // late, drop the OLDEST (stay live, never drift behind)
      if (this.queue.length > 50) {
        this.queue.splice(0, this.queue.length - 50);
        this.offset = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    if (!this.primed) {
      // Amorcage : silence propre (pas un underrun - un choix)
      for (let k = 0; k < L.length; k++) { L[k] = 0; R[k] = 0; }
      return true;
    }
    let i = 0;
    while (i < L.length) {
      const buf = this.queue[0];
      if (!buf) {
        for (; i < L.length; i++) { L[i] = 0; R[i] = 0; }
        this.underruns++;
        this.primed = false;  // famine : on se re-amorce a PRIME blocs
        break;
      }
      const frames = buf.length / 2;
      const take = Math.min(frames - this.offset, L.length - i);
      for (let k = 0; k < take; k++) {
        L[i + k] = buf[(this.offset + k) * 2];
        R[i + k] = buf[(this.offset + k) * 2 + 1];
      }
      i += take;
      this.offset += take;
      if (this.offset >= frames) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('tap-player', TapPlayer);
