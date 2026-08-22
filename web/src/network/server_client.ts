// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * WebSocket client for connecting to the sync server.
 */

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

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
  //
  // PERSISTED (debt settled): the queue is mirrored to localStorage under
  // a per-tab key, and ORPHAN queues (tabs closed mid-outage) are adopted
  // by the next connection to the same project. Replaying an
  // already-known Automerge change is a CRDT no-op, so every race in
  // this scheme resolves to a harmless duplicate, never a loss.
  private outbox: Uint8Array[] = [];
  private readonly tabId: string =
    (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
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
              // changes can now be delivered, in emission order - orphaned
              // queues (closed tabs) first, they are older
              this.adoptOrphanOutboxes();
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
      this.persistOutbox();
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
    this.persistOutbox();
  }

  // ---- Outbox persistence (localStorage, never blocking) -------------------
  // Key scheme: daw-outbox:<projectId>:<tabId>. Storage can be absent,
  // full, or denied - every access is try/catch and the in-memory queue
  // stays authoritative.

  private storageKey(): string {
    return `daw-outbox:${this.projectId}:${this.tabId}`;
  }

  private persistOutbox(): void {
    try {
      if (this.outbox.length === 0) {
        localStorage.removeItem(this.storageKey());
      } else {
        localStorage.setItem(
          this.storageKey(),
          JSON.stringify(this.outbox.map(encodeBase64))
        );
      }
    } catch {
      // storage unavailable: the in-memory queue still works
    }
  }

  /**
   * Adopt queues left by tabs that closed during an outage: their changes
   * go IN FRONT of ours (they are older), their keys are removed, and the
   * merged queue is re-persisted under OUR key before flushing - a crash
   * between those steps leaves duplicates, never losses. A live sibling
   * tab whose key we adopt simply re-persists on its next queued change.
   */
  private adoptOrphanOutboxes(): void {
    try {
      const prefix = `daw-outbox:${this.projectId}:`;
      const orphanKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix) && key !== this.storageKey()) {
          orphanKeys.push(key);
        }
      }
      if (orphanKeys.length === 0) return;
      const adopted: Uint8Array[] = [];
      for (const key of orphanKeys) {
        const raw = localStorage.getItem(key);
        if (raw) {
          for (const b64 of JSON.parse(raw) as string[]) {
            adopted.push(decodeBase64(b64));
          }
        }
      }
      if (adopted.length > 0) {
        console.log(`Adopting ${adopted.length} change(s) from ${orphanKeys.length} closed tab(s)`);
        this.outbox.unshift(...adopted);
      }
      this.persistOutbox();
      for (const key of orphanKeys) {
        localStorage.removeItem(key);
      }
    } catch {
      // storage unavailable: nothing to adopt
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
