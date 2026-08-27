// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * S8c - the audio IN the pipe.
 *
 * Broadcaster: AudioTap batches (engine post-master PCM over loopback
 * WS) feed a tap-player AudioWorklet whose output lands in a
 * MediaStreamAudioDestinationNode - THAT stream rides the
 * RTCPeerConnection (Opus and jitter are the browser's problem).
 *
 * Listener: the remote MediaStream plays through an <audio> element.
 * Autoplay policy: play() is attempted; when the browser refuses
 * (no user gesture yet), the next click anywhere retries - the badge
 * says which state we are in.
 */

export class JamAudio {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private remoteEl: HTMLAudioElement | null = null;

  /** 'idle' | 'ready' | 'playing' | 'blocked' - for the badge. */
  playbackState: 'idle' | 'ready' | 'playing' | 'blocked' = 'idle';
  onStateChange: (() => void) | null = null;

  /** Broadcaster: build the outgoing stream (idempotent). */
  async initBroadcast(): Promise<MediaStream | null> {
    if (this.dest) return this.dest.stream;
    try {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      await this.ctx.audioWorklet.addModule('/tap-player-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'tap-player',
        { outputChannelCount: [2] });
      this.dest = this.ctx.createMediaStreamDestination();
      this.node.connect(this.dest);
      // A suspended context still exposes the stream; resume needs a
      // gesture - the JAM button click IS one on the manual path.
      void this.ctx.resume().catch(() => {});
      return this.dest.stream;
    } catch (e) {
      console.warn('jam audio init failed:', e);
      return null;
    }
  }

  /** Broadcaster: feed one AudioTap batch (interleaved f32 bytes). */
  feed(samples: Uint8Array, blockCount: number): void {
    if (!this.node || blockCount === 0) return;
    // Copy out of the protobuf buffer, one block per worklet message
    const blockBytes = (samples.byteLength / blockCount) | 0;
    for (let b = 0; b < blockCount; b++) {
      const slice = samples.slice(b * blockBytes, (b + 1) * blockBytes);
      const f32 = new Float32Array(slice.buffer, slice.byteOffset,
                                   slice.byteLength / 4);
      const copy = new Float32Array(f32);  // transferable-safe copy
      this.node.port.postMessage(copy, [copy.buffer]);
    }
  }

  /**
   * SPIKE LATENCE s2 : stats du worklet (le hook 'stats?' existait dans
   * tap-player-worklet.js sans aucun consommateur). Renvoie
   * {underruns, queued} - queued * 256 / 48000 = le dwell du FIFO
   * broadcaster, un etage du tableau de latence.
   */
  workletStats(timeoutMs = 1000): Promise<{ underruns: number;
    queued: number } | null> {
    const node = this.node;
    if (!node) return Promise.resolve(null);
    return new Promise((resolve) => {
      const to = window.setTimeout(() => resolve(null), timeoutMs);
      const onMsg = (ev: MessageEvent) => {
        if (ev.data && typeof ev.data.queued === 'number') {
          window.clearTimeout(to);
          node.port.removeEventListener('message', onMsg);
          resolve(ev.data as { underruns: number; queued: number });
        }
      };
      node.port.addEventListener('message', onMsg);
      node.port.start();
      node.port.postMessage('stats?');
    });
  }

  /** Listener: play a remote stream (autoplay-policy aware). */
  playRemote(stream: MediaStream): void {
    if (!this.remoteEl) {
      this.remoteEl = new Audio();
      this.remoteEl.autoplay = true;
    }
    this.remoteEl.srcObject = stream;
    this.playbackState = 'ready';
    const tryPlay = () => {
      this.remoteEl!.play().then(() => {
        this.playbackState = 'playing';
        this.onStateChange?.();
      }).catch(() => {
        this.playbackState = 'blocked';
        this.onStateChange?.();
        // One retry per user gesture until it takes
        window.addEventListener('click', tryPlay, { once: true });
      });
    };
    tryPlay();
  }

  /** Listener: explicit gesture path - the badge's real ▶ button. */
  resume(): void {
    if (!this.remoteEl) return;
    this.remoteEl.play().then(() => {
      this.playbackState = 'playing';
      this.onStateChange?.();
    }).catch(() => {});
  }

  stop(): void {
    this.remoteEl?.pause();
    if (this.remoteEl) this.remoteEl.srcObject = null;
    this.node?.disconnect();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.node = null;
    this.dest = null;
    this.playbackState = 'idle';
    this.onStateChange?.();
  }
}
