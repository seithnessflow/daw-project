// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * S8b - the jam TRAVERSAL: RTCPeerConnection between tabs, signaling
 * relayed as text by the sync server (pure signaling, ADR-019 kept).
 *
 * v1 topology: ONE broadcaster per project (the tab that presses JAM),
 * any number of listeners. S8b establishes the connection and MEASURES
 * round-trip latency over a DataChannel ping (displayed, never
 * promised); the audio itself rides in S8c.
 *
 * STUN only - no TURN in v1: a strict-NAT pair fails CLEANLY (state
 * 'failed' surfaces in the UI, written in STREAMING-DESIGN.md).
 */

import type { ServerClient } from './server_client';

type SignalMsg = {
  jam: true;
  from: string;
  to?: string;             // directed (answers/ice); absent = broadcast
  kind: 'offer' | 'answer' | 'ice' | 'bye';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export type JamRole = 'idle' | 'broadcasting' | 'listening';

export class JamChannel {
  private server: ServerClient;
  private peers = new Map<string, RTCPeerConnection>();
  private channels = new Map<string, RTCDataChannel>();
  private pingTimer: number | null = null;

  role: JamRole = 'idle';
  /** Latest measured round-trip (ms), per peer id. */
  latencyMs = new Map<string, number>();
  onStateChange: (() => void) | null = null;
  /** S8c hook: a remote audio track arrived (listener side). */
  onRemoteTrack: ((stream: MediaStream) => void) | null = null;
  /** S8c hook: broadcaster provides its outgoing stream when asked. */
  localStreamProvider: (() => MediaStream | null) | null = null;

  constructor(server: ServerClient) {
    this.server = server;
    server.onSignal = (raw) => this.handleSignal(raw as SignalMsg);
  }

  /** The tab becomes THE broadcaster: announces an offer to the room. */
  startBroadcast(): void {
    if (this.role !== 'idle') return;
    this.role = 'broadcasting';
    this.onStateChange?.();
    // Listeners join by answering; nothing to do until one appears.
    // Announce presence so already-open tabs can request an offer.
    this.send({ jam: true, from: this.server.id, kind: 'bye' });  // clears stale
    this.announce();
  }

  private announce(): void {
    // A broadcast 'offer' PER newcomer is created on demand: newcomers
    // send a directed 'offer' REQUEST via kind:'ice' abuse? Keep it
    // simple: the broadcaster broadcasts a fresh offer for anyone
    // unattached; each listener answers directed. One shared offer per
    // listener is required by WebRTC, so the LISTENER initiates: it
    // broadcasts kind:'offer' with NO sdp as a JOIN request, and the
    // broadcaster replies with a directed real offer.
    this.send({ jam: true, from: this.server.id, kind: 'offer' });
  }

  /** The tab listens: asks the room's broadcaster for an offer. */
  startListen(): void {
    if (this.role !== 'idle') return;
    this.role = 'listening';
    this.onStateChange?.();
    // JOIN request (empty offer): the broadcaster responds directed
    this.send({ jam: true, from: this.server.id, kind: 'offer' });
  }

  /** Re-assert the jam state after a (re)connection: a listener's JOIN
   *  may have been lost with the old socket; the broadcaster just
   *  waits for JOINs. Called from the app's onConnect. */
  reassert(): void {
    if (this.role === 'listening' && this.peerCount() === 0) {
      this.send({ jam: true, from: this.server.id, kind: 'offer' });
    }
  }

  stop(): void {
    this.send({ jam: true, from: this.server.id, kind: 'bye' });
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.channels.clear();
    this.latencyMs.clear();
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.role = 'idle';
    this.onStateChange?.();
  }

  peerCount(): number {
    let n = 0;
    for (const pc of this.peers.values()) {
      if (pc.connectionState === 'connected') n++;
    }
    return n;
  }

  private send(msg: SignalMsg): void {
    this.server.sendSignal(msg);
  }

  private newPeer(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peers.get(peerId)?.close();
    this.peers.set(peerId, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({ jam: true, from: this.server.id, to: peerId,
                    kind: 'ice', candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => this.onStateChange?.();
    pc.ontrack = (e) => {
      if (e.streams[0]) this.onRemoteTrack?.(e.streams[0]);
    };
    return pc;
  }

  private startPing(peerId: string, ch: RTCDataChannel): void {
    ch.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.ping !== undefined) {
        ch.send(JSON.stringify({ pong: m.ping }));
      } else if (m.pong !== undefined) {
        this.latencyMs.set(peerId, Math.round(performance.now() - m.pong));
        this.onStateChange?.();
      }
    };
    if (this.pingTimer === null) {
      this.pingTimer = window.setInterval(() => {
        for (const c of this.channels.values()) {
          if (c.readyState === 'open') {
            c.send(JSON.stringify({ ping: performance.now() }));
          }
        }
      }, 2000);
    }
  }

  private async handleSignal(msg: SignalMsg): Promise<void> {
    if (!msg?.jam || msg.from === this.server.id) return;      // not mine to hear
    if (msg.to && msg.to !== this.server.id) return;           // directed elsewhere
    try {
      if (msg.kind === 'offer' && !msg.sdp) {
        // Empty offer = JOIN request (listener) or ANNOUNCE (a
        // broadcaster that just started). A waiting listener must
        // RAISE ITS HAND again on an announce - otherwise a listener
        // that arrived FIRST never hooks a later broadcaster (found
        // live: 'jam diffuse 0 pair(s)' on the real two-machine run).
        if (this.role === 'listening' && !msg.to &&
            this.peerCount() === 0 && !this.peers.has(msg.from)) {
          this.send({ jam: true, from: this.server.id, kind: 'offer' });
          return;
        }
        if (this.role !== 'broadcasting') return;
        const pc = this.newPeer(msg.from);
        const ch = pc.createDataChannel('jam-ctl');
        this.channels.set(msg.from, ch);
        ch.onopen = () => this.startPing(msg.from, ch);
        // S8c: attach the outgoing audio stream when available
        const stream = this.localStreamProvider?.();
        if (stream) {
          for (const track of stream.getTracks()) pc.addTrack(track, stream);
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send({ jam: true, from: this.server.id, to: msg.from,
                    kind: 'offer', sdp: offer.sdp ?? '' });
      } else if (msg.kind === 'offer' && msg.sdp) {
        // A real, directed offer from the broadcaster
        if (this.role !== 'listening') return;
        const pc = this.newPeer(msg.from);
        pc.ondatachannel = (e) => {
          this.channels.set(msg.from, e.channel);
          e.channel.onopen = () => this.startPing(msg.from, e.channel);
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ jam: true, from: this.server.id, to: msg.from,
                    kind: 'answer', sdp: answer.sdp ?? '' });
      } else if (msg.kind === 'answer' && msg.sdp) {
        await this.peers.get(msg.from)
          ?.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      } else if (msg.kind === 'ice' && msg.candidate) {
        await this.peers.get(msg.from)?.addIceCandidate(msg.candidate);
      } else if (msg.kind === 'bye') {
        this.peers.get(msg.from)?.close();
        this.peers.delete(msg.from);
        this.channels.delete(msg.from);
        this.latencyMs.delete(msg.from);
        this.onStateChange?.();
      }
    } catch (e) {
      console.warn('jam signal handling failed:', e);
      this.onStateChange?.();
    }
  }
}
