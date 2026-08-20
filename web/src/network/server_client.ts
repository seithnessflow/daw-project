/**
 * WebSocket client for connecting to the sync server.
 */

export class ServerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private projectId: string = '';
  private reconnectTimer: number | null = null;

  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onDocument: ((data: Uint8Array) => void) | null = null;
  onChange: ((change: Uint8Array) => void) | null = null;

  constructor(baseUrl: string) {
    this.url = baseUrl;
  }

  /**
   * Connect to a project.
   */
  async connect(projectId: string): Promise<void> {
    this.projectId = projectId;
    const wsUrl = `${this.url}/ws/${projectId}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('Server WebSocket connected');
          this.onConnect?.();
          resolve();
        };

        this.ws.onclose = () => {
          console.log('Server WebSocket closed');
          this.onDisconnect?.();
          this.scheduleReconnect();
        };

        this.ws.onerror = (event) => {
          console.error('Server WebSocket error:', event);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            const data = new Uint8Array(event.data);
            // First message is the full document, subsequent are changes
            if (this.onDocument) {
              this.onDocument(data);
              // Switch to change handler after first message
              this.onDocument = null;
            } else {
              this.onChange?.(data);
            }
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Disconnect from the server.
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
   * Send a change to the server.
   */
  sendChange(change: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(change);
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      console.log('Attempting to reconnect to server...');
      this.connect(this.projectId).catch(console.error);
    }, 3000);
  }
}
