// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Protocol helpers for engine communication.
 *
 * Uses generated Protobuf code from messages.proto.
 * Messages are length-prefixed (4 bytes big-endian).
 */

import {
  Message,
  TransportCommand_Action,
  RenderState_Status,
  type TransportPosition,
  type Meters,
  type EngineState,
  type AudioTap,
  type PluginCatalog,
  type SessionState,
  type RenderState,
  type Error as ProtoError,
} from '../proto/messages';

// Re-export types for convenience
export { TransportCommand_Action as TransportAction, RenderState_Status };
export type { EngineState, Meters, TransportPosition, AudioTap, PluginCatalog,
  SessionState, RenderState };

// Decoded message types for the client
export type DecodedMessage =
  | { type: 'position'; data: TransportPosition }
  | { type: 'meters'; data: Meters }
  | { type: 'state'; data: EngineState }
  | { type: 'audioTap'; data: AudioTap }
  | { type: 'pluginCatalog'; data: PluginCatalog }
  | { type: 'sessionState'; data: SessionState }
  | { type: 'renderState'; data: RenderState }
  | { type: 'error'; data: ProtoError };

// Encode message types
export type EncodeMessage =
  | { type: 'transport'; data: { action: TransportCommand_Action; seekPosition?: number; loopEnabled?: boolean } }
  | { type: 'setMonitor'; data: { trackId: string; solo: boolean; mute: boolean } }
  | { type: 'tapControl'; data: { enabled: boolean } }
  | { type: 'editor'; data: { nodeId: string; open: boolean } }
  | { type: 'sessionLaunch'; data: { sceneId: string; trackId: string; stop: boolean; quantize: boolean } }
  | { type: 'renderRequest'; data: { bitDepth: number } };

/**
 * Encode a message to binary with length prefix.
 */
export function encodeMessage(msg: EncodeMessage): Uint8Array {
  let protoMessage: Message;

  switch (msg.type) {
    case 'transport':
      protoMessage = {
        transport: {
          action: msg.data.action,
          seekPosition: msg.data.seekPosition ?? 0,
          loopEnabled: msg.data.loopEnabled ?? false,
        },
      };
      break;
    case 'setMonitor':
      protoMessage = {
        setMonitor: {
          trackId: msg.data.trackId,
          solo: msg.data.solo,
          mute: msg.data.mute,
        },
      };
      break;
    case 'tapControl':
      protoMessage = {
        tapControl: { enabled: msg.data.enabled },
      };
      break;
    case 'editor':
      protoMessage = {
        editor: { nodeId: msg.data.nodeId, open: msg.data.open },
      };
      break;
    case 'sessionLaunch':
      protoMessage = {
        sessionLaunch: {
          sceneId: msg.data.sceneId,
          trackId: msg.data.trackId,
          stop: msg.data.stop,
          quantize: msg.data.quantize,
        },
      };
      break;
    case 'renderRequest':
      protoMessage = {
        renderRequest: { bitDepth: msg.data.bitDepth },
      };
      break;
  }

  // Encode the message
  const encoded = Message.encode(protoMessage).finish();

  // Add length prefix (4 bytes big-endian)
  const result = new Uint8Array(4 + encoded.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, encoded.length, false); // big-endian
  result.set(encoded, 4);

  return result;
}

/**
 * Decode a length-prefixed binary message.
 */
export function decodeMessage(data: ArrayBuffer): DecodedMessage | null {
  try {
    const bytes = new Uint8Array(data);

    // Check minimum size (4 byte length + at least 1 byte payload)
    if (bytes.length < 5) {
      console.warn('Message too short:', bytes.length);
      return null;
    }

    // Read length prefix
    const view = new DataView(data);
    const length = view.getUint32(0, false); // big-endian

    // Validate length
    if (length + 4 !== bytes.length) {
      console.warn('Length mismatch:', length, 'vs', bytes.length - 4);
      return null;
    }

    // Decode protobuf message
    const payload = bytes.slice(4);
    const msg = Message.decode(payload);

    // Determine message type
    if (msg.position !== undefined) {
      return { type: 'position', data: msg.position };
    }
    if (msg.meters !== undefined) {
      return { type: 'meters', data: msg.meters };
    }
    if (msg.engineState !== undefined) {
      return { type: 'state', data: msg.engineState };
    }
    if (msg.audioTap !== undefined) {
      return { type: 'audioTap', data: msg.audioTap };
    }
    if (msg.pluginCatalog !== undefined) {
      return { type: 'pluginCatalog', data: msg.pluginCatalog };
    }
    if (msg.sessionState !== undefined) {
      return { type: 'sessionState', data: msg.sessionState };
    }
    if (msg.renderState !== undefined) {
      return { type: 'renderState', data: msg.renderState };
    }
    if (msg.error !== undefined) {
      return { type: 'error', data: msg.error };
    }

    console.warn('Unknown message type');
    return null;
  } catch (e) {
    console.error('Failed to decode message:', e);
    return null;
  }
}
