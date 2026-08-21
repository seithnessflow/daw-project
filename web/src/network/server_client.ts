/**
 * WebSocket client for connecting to the sync server.
 */

export class ServerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private projectId: string = '';
  private reconnectTimer: number | null = null;

  // Per-connection protocol state: the server always sends the full stored
  // document as the FIRST message of every connection, then incremental
  // changes. Re-armed on every open, so reconnects are unambiguous without
  // any message-type prefix.
  private awaitingInitialDoc = true;

  // Outbox: changes emitted while disconnected (or before the initial
  // document arrives) accumulate here and are sent, in order, once the
  // initial document of the (re)connection has been delivered.
  // In-memory only: a closed tab loses its queue (known, separate debt).
  private outbox: Uint8Array[] = [];
  private resyncTimer: number | null = null;

  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  /** Called with the full document at the start of EVERY connection. */
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
          this.awaitingInitialDoc = true;
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
            // First message of each connection is the full document,
            // subsequent ones are incremental changes
            if (this.awaitingInitialDoc) {
              this.awaitingInitialDoc = false;
              this.onDocument?.(data);
              // The app has merged the server document: local offline
              // changes can now be delivered, in emission order
              this.flushOutbox();
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
    if (this.resyncTimer !== null) {
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Send a change to the server.
   *
   * While disconnected (or before the connection's initial document has
   * arrived), the change is queued and delivered after reconnection, in
   * order. Nothing is silently dropped.
   */
  sendChange(change: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN && !this.awaitingInitialDoc) {
      this.ws.send(change);
    } else {
      this.outbox.push(change);
      console.log(`Server offline: change queued (${this.outbox.length} pending)`);
    }
  }

  private flushOutbox(): void {
    if (this.ws?.readyState !== WebSocket.OPEN || this.outbox.length === 0) {
      return;
    }
    console.log(`Flushing ${this.outbox.length} queued change(s) to server`);
    while (this.outbox.length > 0) {
      const change = this.outbox.shift()!;
      this.ws.send(change);
    }
  }

  /**
   * Number of changes waiting to be delivered.
   */
  pendingCount(): number {
    return this.outbox.length;
  }

  /**
   * Anti-entropy: schedule one resync cycle (close + auto-reconnect, which
   * makes the server send its current full document again for merging).
   *
   * Needed because the server broadcasts a change BEFORE persisting it: a
   * peer reconnecting in that window can both miss the broadcast and read
   * a stale stored document. The app requests a resync after any
   * reconnection that brought novelty or delivered queued changes, and
   * stops as soon as an exchange is a no-op.
   */
  requestResync(delayMs = 1000): void {
    if (this.resyncTimer !== null) return;
    this.resyncTimer = window.setTimeout(() => {
      this.resyncTimer = null;
      console.log('Resync: refreshing server document');
      // close() triggers onclose, which schedules the reconnection
      this.ws?.close();
    }, delayMs);
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
