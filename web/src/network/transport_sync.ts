// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * L1b - TRANSPORT ANCHORS (LINK-DESIGN etages 1+3).
 *
 * The shared transport state is an ANCHOR {playing, posSec, t}, a pure
 * function of session time - never a "PLAY!" event ("now" does not
 * exist on a network). Position right now = posSec + (now - t). Anchors
 * travel the existing signal: relay; the receiver translates the
 * sender's timebase with the CURRENT L1a clock offset - never a frozen
 * one (real inter-machine drift measured at ~200 ppm, 12 ms/min).
 *
 * LWW: the newest anchor in local time wins, ties by peer id - nobody
 * is the master (Link's lesson). SYNC is opt-in PERFORMANCE state
 * (Live's Start Stop Sync), never the CRDT (ADR-002).
 * L1c still owns: rejoin mid-playback (anchors are gesture-sent, not
 * re-broadcast) and the jam-vs-sync arbitration (LINK-DESIGN 4).
 */

import type { ServerClient } from './server_client';
import type { SessionClock } from './session_clock';

type Anchor = { playing: boolean; posSec: number; localT: number; peer: string };

export class TransportSync {
  enabled = false;
  /** Apply a translated remote anchor to the LOCAL engine. posSec is
   *  where the anchor says we must be RIGHT NOW (late messages and
   *  relay latency already accounted for). */
  onApply: ((playing: boolean, posSec: number) => void) | null = null;
  onStateChange: (() => void) | null = null;

  private server: ServerClient;
  private clock: SessionClock;
  private last: Anchor | null = null;   // LWW state, local timebase
  private pending:
    { from: string; playing: boolean; posSec: number; t: number } | null = null;
  private retryTimer: number | null = null;
  // Probe counters (window.__dawSync.snapshot(), the piloting eyes)
  private published = 0;
  private applied = 0;
  private ignored = 0;                  // received while SYNC is off
  private lastPublished:
    { playing: boolean; posSec: number; t: number } | null = null;
  private lastApplied:
    { playing: boolean; posSec: number; appliedAtLocal: number } | null = null;

  constructor(server: ServerClient, clock: SessionClock) {
    this.server = server;
    this.clock = clock;
    server.addSignalListener((raw) => this.handleSignal(raw));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.pending = null;
    this.onStateChange?.();
  }

  /** Local gesture (play/stop pressed HERE): broadcast our anchor. */
  publish(playing: boolean, posSec: number): void {
    if (!this.enabled) return;
    const t = performance.now();
    this.server.sendSignal({ ta: 1, from: this.server.id, playing, posSec, t });
    this.last = { playing, posSec, localT: t, peer: this.server.id };
    this.published++;
    this.lastPublished = { playing, posSec, t };
    this.onStateChange?.();
  }

  private handleSignal(raw: unknown): void {
    const m = raw as { ta?: number; from?: string; playing?: boolean;
                       posSec?: number; t?: number };
    if (!m || m.ta !== 1 || !m.from || m.from === this.server.id ||
        typeof m.playing !== 'boolean' || typeof m.posSec !== 'number' ||
        typeof m.t !== 'number') return;
    if (!this.enabled) { this.ignored++; this.onStateChange?.(); return; }
    this.pending = { from: m.from, playing: m.playing, posSec: m.posSec, t: m.t };
    this.tryApply();
  }

  /** Translation needs a clock estimate for the sender; until the L1a
   *  ping delivers one the anchor WAITS (bounded retry) - guessing
   *  offset 0 is wrong even on one machine (per-tab epochs, 580 ms
   *  measured between two tabs). */
  private tryApply(): void {
    const p = this.pending;
    if (!p) return;
    const pc = this.clock.peers().get(p.from);
    if (!pc) {
      if (this.retryTimer === null) {
        this.retryTimer = window.setTimeout(() => {
          this.retryTimer = null;
          this.tryApply();
        }, 250);
      }
      return;
    }
    this.pending = null;
    // Sender timebase -> ours, with the CURRENT offset (drift rule)
    const localT = p.t - pc.offsetMs;
    if (this.last && (localT < this.last.localT ||
        (localT === this.last.localT && p.from < this.last.peer))) return;
    this.last = { playing: p.playing, posSec: p.posSec, localT, peer: p.from };
    const now = performance.now();
    const posNow = p.playing
      ? Math.max(0, p.posSec + (now - localT) / 1000)
      : Math.max(0, p.posSec);
    this.applied++;
    this.lastApplied = { playing: p.playing, posSec: posNow, appliedAtLocal: now };
    this.onApply?.(p.playing, posNow);
    this.onStateChange?.();
  }

  snapshot() {
    return {
      enabled: this.enabled,
      published: this.published,
      applied: this.applied,
      ignored: this.ignored,
      lastPublished: this.lastPublished,
      lastApplied: this.lastApplied,
    };
  }
}
