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
    this.port.onmessage = (e) => {
      if (e.data === 'stats?') {
        this.port.postMessage({ underruns: this.underruns, queued: this.queue.length });
        return;
      }
      this.queue.push(e.data);
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
    let i = 0;
    while (i < L.length) {
      const buf = this.queue[0];
      if (!buf) {
        for (; i < L.length; i++) { L[i] = 0; R[i] = 0; }
        this.underruns++;
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
