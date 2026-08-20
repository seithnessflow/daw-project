/**
 * WebSocket client for connecting to the local audio engine.
 *
 * In a full implementation, this would use Protobuf encoding.
 * For slice 1, we use simple JSON messages.
 */

interface MeterData {
  trackId: string;
  peakLeft: number;
  peakRight: number;
}

export class EngineClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: number | null = null;

  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onPosition: ((samples: number, sampleRate: number) => void) | null = null;
  onMeters: ((meters: MeterData[]) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to the engine.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('Engine WebSocket connected');
          this.onConnect?.();
          resolve();
        };

        this.ws.onclose = () => {
          console.log('Engine WebSocket closed');
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
    this.sendCommand({ type: 'transport', action: 'play' });
  }

  /**
   * Send stop command.
   */
  stop(): void {
    this.sendCommand({ type: 'transport', action: 'stop' });
  }

  /**
   * Send seek command.
   */
  seek(positionSamples: number): void {
    this.sendCommand({
      type: 'transport',
      action: 'seek',
      position: positionSamples,
    });
  }

  /**
   * Set track gain.
   */
  setGain(trackId: string, gain: number): void {
    this.sendCommand({
      type: 'setGain',
      trackId,
      gain,
    });
  }

  /**
   * Load a document.
   */
  loadDocument(data: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send as binary with type prefix
      const prefix = new TextEncoder().encode('DOC:');
      const message = new Uint8Array(prefix.length + data.length);
      message.set(prefix);
      message.set(data, prefix.length);
      this.ws.send(message);
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private sendCommand(cmd: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }

  private handleMessage(data: ArrayBuffer | string): void {
    try {
      // Try to parse as JSON
      let json: string;
      if (data instanceof ArrayBuffer) {
        json = new TextDecoder().decode(data);
      } else {
        json = data;
      }

      const msg = JSON.parse(json);

      switch (msg.type) {
        case 'position':
          this.onPosition?.(msg.samples, msg.sampleRate);
          break;
        case 'meters':
          this.onMeters?.(msg.tracks);
          break;
        case 'error':
          this.onError?.(msg.message);
          break;
        case 'state':
          console.log('Engine state:', msg);
          break;
      }
    } catch (e) {
      console.error('Failed to parse engine message:', e);
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
