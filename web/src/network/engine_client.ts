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
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = `ws://${this.address}:${this.port}/?token=${encodeURIComponent(this.token)}`;
        console.log(`Connecting to engine at ${this.address}:${this.port}`);

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('Engine WebSocket connected');
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
   * Set track gain.
   */
  setGain(trackId: string, gain: number): void {
    const message = encodeMessage({
      type: 'setTrackGain',
      data: { trackId, gain },
    });
    this.sendBinary(message);
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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
