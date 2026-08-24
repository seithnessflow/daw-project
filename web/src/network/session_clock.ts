// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * L1a - the SESSION CLOCK (LINK-DESIGN, etage 1).
 *
 * Every tab estimates every peer's clock offset NTP-style over the
 * existing signal: relay - no new channel, no server code. Ping
 * broadcasts t1; the pong comes back directed with {t1, t2}; then
 * offset = t2 - (t1 + rtt/2). The estimate keeps only the LOW-RTT
 * samples (relay jitter poisons the tail) and takes their median.
 * performance.now() is the clock: monotonic, immune to wall-clock
 * adjustments.
 *
 * Nobody is the master (Link's lesson). L1b will translate transport
 * anchors {position, session time} with these offsets; the clock
 * itself never touches the transport.
 */

import type { ServerClient } from './server_client';

type Sample = { offset: number; rtt: number };

export type PeerClock = {
  /** Remote clock minus ours (ms); positive = the peer is ahead. */
  offsetMs: number;
  /** Best observed round trip (ms). */
  rttMs: number;
  samples: number;
};

const WINDOW = 16;       // sliding samples kept per peer
const PING_MS = 2000;    // same cadence as the jam-ctl ping
const STALE_MS = 30000;  // no pong in 30 s -> the peer is forgotten
const MAX_RTT_MS = 5000; // beyond this a sample is noise, not data

export class SessionClock {
  private server: ServerClient;
  private perPeer = new Map<string, Sample[]>();
  private lastHeard = new Map<string, number>();
  private timer: number | null = null;
  onStateChange: (() => void) | null = null;

  constructor(server: ServerClient) {
    this.server = server;
    server.addSignalListener((raw) => this.handleSignal(raw));
    this.timer = window.setInterval(() => this.tick(), PING_MS);
  }

  private tick(): void {
    this.server.sendSignal({ clk: 1, from: this.server.id,
                             t1: performance.now() });
    // Expire peers that stopped answering (tab closed without bye)
    const now = performance.now();
    for (const [id, heard] of this.lastHeard) {
      if (now - heard > STALE_MS) {
        this.perPeer.delete(id);
        this.lastHeard.delete(id);
        this.onStateChange?.();
      }
    }
  }

  private handleSignal(raw: unknown): void {
    const m = raw as { clk?: number; from?: string; to?: string;
                       t1?: number; t2?: number };
    if (!m || typeof m.clk !== 'number' || !m.from ||
        m.from === this.server.id) return;
    if (m.clk === 1 && typeof m.t1 === 'number') {
      // Answer directed, immediately - our processing time is inside
      // the reader's rtt, so the pong must not linger
      this.server.sendSignal({ clk: 2, from: this.server.id, to: m.from,
                               t1: m.t1, t2: performance.now() });
    } else if (m.clk === 2 && m.to === this.server.id &&
               typeof m.t1 === 'number' && typeof m.t2 === 'number') {
      const t3 = performance.now();
      const rtt = t3 - m.t1;
      if (rtt < 0 || rtt > MAX_RTT_MS) return;
      const offset = m.t2 - (m.t1 + rtt / 2);
      const win = this.perPeer.get(m.from) ?? [];
      win.push({ offset, rtt });
      if (win.length > WINDOW) win.shift();
      this.perPeer.set(m.from, win);
      this.lastHeard.set(m.from, t3);
      this.onStateChange?.();
    }
  }

  /** Current estimate per peer (filtered to low-rtt samples, median). */
  peers(): Map<string, PeerClock> {
    const out = new Map<string, PeerClock>();
    for (const [id, win] of this.perPeer) {
      if (win.length === 0) continue;
      const minRtt = Math.min(...win.map((s) => s.rtt));
      const good = win.filter((s) => s.rtt <= minRtt * 1.5 + 1);
      const offs = good.map((s) => s.offset).sort((a, b) => a - b);
      out.set(id, {
        offsetMs: offs[(offs.length - 1) >> 1],
        rttMs: minRtt,
        samples: win.length,
      });
    }
    return out;
  }

  /** Plain-object view for probes (window.__dawClock.snapshot()). */
  snapshot(): Record<string, PeerClock> {
    const out: Record<string, PeerClock> = {};
    for (const [id, pc] of this.peers()) out[id] = pc;
    return out;
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.perPeer.clear();
    this.lastHeard.clear();
  }
}
