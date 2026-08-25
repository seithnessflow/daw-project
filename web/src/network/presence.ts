// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * PRESENCE - the multiplayer overlay (who is here, and what they touch).
 *
 * The document already converges (Automerge); presence is the EPHEMERAL
 * layer that makes collaboration VISIBLE - each peer broadcasts its
 * identity (name + colour) and its current selection over the same
 * signal: relay as the clock and transport (no server code, nothing
 * written to the doc). A peer is forgotten when it stops broadcasting
 * (tab closed) - presence never persists, it is always "now".
 *
 * No accounts yet: name and colour are derived deterministically from
 * the per-session id, so a peer looks the same to everyone. Real
 * identity slots in here later without touching the wire shape.
 */

import type { ServerClient } from './server_client';

export type PeerPresence = {
  id: string;
  name: string;
  color: string;
  selectedTrack: string | null;
  lastSeen: number;
};

const BEAT_MS = 2000;    // heartbeat cadence (same as the clock ping)
const STALE_MS = 6000;   // 3 missed beats -> the peer is gone

// FNV-1a over the id: a stable, well-spread number for colour + name.
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A distinct, saturated colour per peer - stable across every tab. */
export function peerColor(id: string): string {
  return `hsl(${hashId(id) % 360} 70% 60%)`;
}

// Friendly handle until real accounts exist (French animals - the studio
// vibe). The id hash picks one; collisions are cosmetic (the colour and
// the id still disambiguate).
const HANDLES = [
  'Renard', 'Loutre', 'Corbeau', 'Lynx', 'Hibou', 'Blaireau',
  'Martre', 'Belette', 'Faucon', 'Heron', 'Cerf', 'Sanglier',
  'Chouette', 'Genette', 'Putois', 'Fouine',
];
export function peerName(id: string): string {
  return HANDLES[hashId(id) % HANDLES.length];
}

type PresenceMsg = {
  pr?: number;
  from?: string;
  name?: string;
  color?: string;
  sel?: string | null;
};

export class Presence {
  private server: ServerClient;
  private peers = new Map<string, PeerPresence>();
  private timer: number | null = null;
  private mySelection: string | null = null;
  readonly myColor: string;
  readonly myName: string;
  /** Fired whenever the roster or a remote selection changes. */
  onChange: (() => void) | null = null;

  constructor(server: ServerClient) {
    this.server = server;
    this.myColor = peerColor(server.id);
    this.myName = peerName(server.id);
    server.addSignalListener((raw) => this.handleSignal(raw));
    this.timer = window.setInterval(() => this.tick(), BEAT_MS);
    this.broadcast(); // announce immediately, do not wait a beat
  }

  /** The app calls this whenever the local selection moves (idempotent). */
  setSelection(trackId: string | null): void {
    if (trackId === this.mySelection) return;
    this.mySelection = trackId;
    this.broadcast();
  }

  private broadcast(): void {
    this.server.sendSignal({
      pr: 1,
      from: this.server.id,
      name: this.myName,
      color: this.myColor,
      sel: this.mySelection,
    });
  }

  private tick(): void {
    this.broadcast();
    const now = performance.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > STALE_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange?.();
  }

  private handleSignal(raw: unknown): void {
    const m = raw as PresenceMsg;
    if (!m || m.pr !== 1 || !m.from || m.from === this.server.id) return;
    const prev = this.peers.get(m.from);
    const sel = typeof m.sel === 'string' ? m.sel : null;
    this.peers.set(m.from, {
      id: m.from,
      name: typeof m.name === 'string' ? m.name : peerName(m.from),
      color: typeof m.color === 'string' ? m.color : peerColor(m.from),
      selectedTrack: sel,
      lastSeen: performance.now(),
    });
    // A brand-new peer, or one that moved its selection, is a visible change.
    if (!prev || prev.selectedTrack !== sel) this.onChange?.();
  }

  /** Peers currently present (self excluded). */
  list(): PeerPresence[] {
    return [...this.peers.values()];
  }

  /** Peers who have this track selected - drives the remote-selection flag. */
  onTrack(trackId: string): PeerPresence[] {
    return [...this.peers.values()].filter((p) => p.selectedTrack === trackId);
  }

  /** Plain view for probes (window.__dawPresence). */
  snapshot(): Record<string, PeerPresence> {
    const out: Record<string, PeerPresence> = {};
    for (const [id, p] of this.peers) out[id] = p;
    return out;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.peers.clear();
  }
}
