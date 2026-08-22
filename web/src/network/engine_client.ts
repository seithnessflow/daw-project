// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * WebSocket client for connecting to the local audio engine.
 *
 * Uses binary Protobuf encoding matching engine/src/protocol/messages.proto.
 * Requires auth token from %TEMP%/daw-engine-token.
 */

import {
  encodeMessage,
  decodeMessage,
  TransportAction,
  type EngineState,
} from './protocol';

interface MeterData {
  trackId: string;
  peakLeft: number;
  peakRight: number;
}

interface EngineConfig {
  /** Engine WebSocket address (default: 127.0.0.1) */
  address?: string;
  /** Engine WebSocket port (default: 47821) */
  port?: number;
  /** Auth token (required) */
  token?: string;
}

export class EngineClient {
  private ws: WebSocket | null = null;
  private address: string;
  private port: number;
  private token: string;
  private reconnectTimer: number | null = null;
  private sampleRate: number = 48000;

  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onPosition: ((samples: number, sampleRate: number) => void) | null = null;
  onMeters: ((meters: MeterData[]) => void) | null = null;
  onState: ((state: EngineState) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(config: EngineConfig = {}) {
    this.address = config.address ?? '127.0.0.1';
    this.port = config.port ?? 47821;
    this.token = config.token ?? '';
  }

  /**
   * Set the auth token.
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Set connection parameters from token file content.
   */
  setFromTokenFile(content: string): void {
    try {
      const data = JSON.parse(content);
      if (data.token) this.token = data.token;
      if (data.port) this.port = data.port;
      if (data.address) this.address = data.address;
    } catch (e) {
      console.error('Failed to parse token file:', e);
    }
  }

  /**
   * Connect to the engine.
   * Token is sent as the first message after connection (not in URL).
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = `ws://${this.address}:${this.port}/`;
        console.log(`Connecting to engine at ${this.address}:${this.port}`);

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('Engine WebSocket connected, sending auth token');
          // Send token as first message (binary: 1 byte type + token string)
          const tokenBytes = new TextEncoder().encode(this.token);
          const authMessage = new Uint8Array(1 + tokenBytes.length);
          authMessage[0] = 0x00; // Auth message type
          authMessage.set(tokenBytes, 1);
          this.ws!.send(authMessage);
          this.onConnect?.();
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('Engine WebSocket closed:', event.code, event.reason);
          this.onDisconnect?.();
          this.scheduleReconnect();
        };

        this.ws.onerror = (event) => {
          console.error('Engine WebSocket error:', event);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Disconnect from the engine.
   */
  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Send play command.
   */
  play(): void {
    this.sendTransport(TransportAction.PLAY);
  }

  /**
   * Send stop command.
   */
  stop(): void {
    this.sendTransport(TransportAction.STOP);
  }

  /**
   * Send seek command.
   */
  seek(positionSamples: number): void {
    this.sendTransport(TransportAction.SEEK, positionSamples);
  }

  /**
   * Set track monitoring state (solo/mute).
   * Note: Gain is NOT set here - it goes through the Automerge document.
   */
  // Last monitor state per track: the protocol carries ABSOLUTE
  // solo+mute, so a one-sided toggle merges with what we last sent.
  // Engine-local state (not the document): a rebuilt graph re-reads it
  // engine-side via copyMonitorState.
  private monitorState = new Map<string, { solo: boolean; mute: boolean }>();

  setMonitor(trackId: string, solo?: boolean, mute?: boolean): void {
    const prev = this.monitorState.get(trackId) ?? { solo: false, mute: false };
    const next = { solo: solo ?? prev.solo, mute: mute ?? prev.mute };
    this.monitorState.set(trackId, next);
    const message = encodeMessage({
      type: 'setMonitor',
      data: { trackId, solo: next.solo, mute: next.mute },
    });
    this.sendBinary(message);
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Transport state as last reported by telemetry (for the Space toggle)
  private lastPlaying = false;

  isPlaying(): boolean {
    return this.lastPlaying;
  }

  private sendTransport(action: TransportAction, seekPosition?: number): void {
    const data = seekPosition !== undefined
      ? { action, seekPosition }
      : { action };
    const message = encodeMessage({ type: 'transport', data });
    this.sendBinary(message);
  }

  private sendBinary(data: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private handleMessage(data: ArrayBuffer): void {
    const msg = decodeMessage(data);
    if (!msg) {
      console.warn('Failed to decode engine message');
      return;
    }

    switch (msg.type) {
      case 'position':
        this.lastPlaying = msg.data.isPlaying ?? false;
        this.onPosition?.(msg.data.positionSamples, this.sampleRate);
        break;
      case 'meters':
        this.onMeters?.(
          msg.data.tracks.map((t) => ({
            trackId: t.trackId,
            peakLeft: t.peakLeft,
            peakRight: t.peakRight,
          }))
        );
        break;
      case 'state':
        this.onState?.(msg.data);
        break;
      case 'error':
        this.onError?.(msg.data.message);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      console.log('Attempting to reconnect to engine...');
      this.connect().catch(console.error);
    }, 3000);
  }
}
