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
 *
 * L1c: REJOIN - arming SYNC broadcasts a request (ta:2); every armed
 * peer whose engine is PLAYING answers with a FRESH directed anchor
 * re-anchored on its live engine position (never a stored offset - it
 * would have aged by the 200 ppm drift). Stopped peers stay silent:
 * rejoin adopts a running performance, it does not fight over where
 * stopped transports parked. And the jam arbitration (LINK-DESIGN 4,
 * decided 2026-08-24): a jam LISTENER's transport is suspended -
 * anchors are counted (suppressed) but never applied, and it never
 * answers rejoin requests (its transport is not authoritative).
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
  /** L1c rejoin: live engine state, read at answer time. Return null
   *  when the engine is absent or stopped (then we do not answer). */
  anchorProvider: (() => { playing: boolean; posSec: number } | null) | null = null;
  /** L1c jam arbitration: true while this tab listens to a jam - its
   *  transport is suspended (anchors suppressed, no rejoin answers). */
  suspendProvider: (() => boolean) | null = null;

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
  private suppressed = 0;               // received while jam-listening
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
    // L1c rejoin: ask the running peers where the performance is
    if (on) this.server.sendSignal({ ta: 2, from: this.server.id });
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
    const m = raw as { ta?: number; from?: string; to?: string;
                       playing?: boolean; posSec?: number; t?: number };
    if (!m || typeof m.ta !== 'number' || !m.from ||
        m.from === this.server.id) return;
    if (m.to && m.to !== this.server.id) return;   // directed elsewhere
    if (m.ta === 2) {
      // Rejoin request: answer with a FRESH anchor from the live
      // engine, directed - only when armed, playing, and not a jam
      // listener (a suspended transport is not authoritative).
      if (!this.enabled || this.suspendProvider?.()) return;
      const live = this.anchorProvider?.();
      if (!live || !live.playing) return;
      this.server.sendSignal({ ta: 1, from: this.server.id, to: m.from,
                               playing: true, posSec: live.posSec,
                               t: performance.now() });
      return;
    }
    if (m.ta !== 1 || typeof m.playing !== 'boolean' ||
        typeof m.posSec !== 'number' || typeof m.t !== 'number') return;
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
    // L1c jam arbitration: the LWW state above stays current (later
    // anchors still compare right) but a listener's engine is never
    // driven - the remote stream IS its playback.
    if (this.suspendProvider?.()) {
      this.suppressed++;
      this.onStateChange?.();
      return;
    }
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
      suppressed: this.suppressed,
      lastPublished: this.lastPublished,
      lastApplied: this.lastApplied,
    };
  }
}
