/**
 * Protocol encoding/decoding for engine communication.
 *
 * Matches engine/src/protocol/messages.proto
 * Uses manual encoding to avoid protobufjs complexity.
 */

// Field numbers from messages.proto
const FIELD = {
  // Message.oneof
  TRANSPORT: 1,
  SET_MONITOR: 2,
  POSITION: 3,
  METERS: 4,
  ENGINE_STATE: 5,
  ERROR: 6,
  SET_TRACK_GAIN: 7,

  // TransportCommand
  TRANSPORT_ACTION: 1,
  TRANSPORT_SEEK_POSITION: 2,

  // SetTrackGain
  GAIN_TRACK_ID: 1,
  GAIN_VALUE: 2,

  // TransportPosition
  POSITION_SAMPLES: 1,
  POSITION_IS_PLAYING: 2,

  // Meters
  METERS_TRACKS: 1,

  // TrackMeter
  METER_TRACK_ID: 1,
  METER_PEAK_LEFT: 2,
  METER_PEAK_RIGHT: 3,

  // EngineState
  STATE_UNDERRUNS: 1,
  STATE_CPU_PERCENT: 2,
  STATE_LATENCY: 3,
};

// TransportCommand.Action enum
export enum TransportAction {
  PLAY = 0,
  STOP = 1,
  SEEK = 2,
}

// Protobuf wire types
const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

/**
 * Simple protobuf encoder.
 */
class ProtoEncoder {
  private buffer: number[] = [];

  writeVarint(value: number): void {
    while (value > 0x7f) {
      this.buffer.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.buffer.push(value);
  }

  writeTag(field: number, wireType: number): void {
    this.writeVarint((field << 3) | wireType);
  }

  writeInt64(field: number, value: number): void {
    this.writeTag(field, WIRE_VARINT);
    // Handle 64-bit as two 32-bit parts for large values
    if (value < 0 || value > 0x1fffffffffffff) {
      // For negative or very large numbers, use 64-bit encoding
      const low = value >>> 0;
      const high = Math.floor(value / 0x100000000) >>> 0;
      this.writeVarint64(low, high);
    } else {
      this.writeVarint(value);
    }
  }

  private writeVarint64(low: number, high: number): void {
    for (let i = 0; i < 4; i++) {
      this.buffer.push((low & 0x7f) | 0x80);
      low >>>= 7;
    }
    // 4th byte: last 4 bits of low + first 3 bits of high
    this.buffer.push(((low & 0x0f) | ((high & 0x07) << 4)) | 0x80);
    high >>>= 3;
    while (high > 0x7f) {
      this.buffer.push((high & 0x7f) | 0x80);
      high >>>= 7;
    }
    this.buffer.push(high);
  }

  writeFloat(field: number, value: number): void {
    this.writeTag(field, WIRE_32BIT);
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true); // little-endian
    for (let i = 0; i < 4; i++) {
      this.buffer.push(view.getUint8(i));
    }
  }

  writeString(field: number, value: string): void {
    this.writeTag(field, WIRE_LENGTH);
    const bytes = new TextEncoder().encode(value);
    this.writeVarint(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      this.buffer.push(bytes[i]);
    }
  }

  writeBool(field: number, value: boolean): void {
    this.writeTag(field, WIRE_VARINT);
    this.buffer.push(value ? 1 : 0);
  }

  writeBytes(field: number, value: Uint8Array): void {
    this.writeTag(field, WIRE_LENGTH);
    this.writeVarint(value.length);
    for (let i = 0; i < value.length; i++) {
      this.buffer.push(value[i]);
    }
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Simple protobuf decoder.
 */
class ProtoDecoder {
  private view: DataView;
  private pos: number = 0;

  constructor(data: ArrayBuffer) {
    this.view = new DataView(data);
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  readVarint(): number {
    let result = 0;
    let shift = 0;
    while (this.pos < this.view.byteLength) {
      const byte = this.view.getUint8(this.pos++);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readVarintSigned(): number {
    const value = this.readVarint();
    return value >>> 0; // Treat as unsigned for now
  }

  readInt64(): number {
    // Read varint as 64-bit (simplified for position values)
    let result = 0;
    let shift = 0;
    while (this.pos < this.view.byteLength && shift < 64) {
      const byte = this.view.getUint8(this.pos++);
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  readTag(): { field: number; wireType: number } | null {
    if (this.pos >= this.view.byteLength) return null;
    const tag = this.readVarint();
    return {
      field: tag >>> 3,
      wireType: tag & 0x07,
    };
  }

  readFloat(): number {
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  readString(): string {
    const length = this.readVarint();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, length);
    this.pos += length;
    return new TextDecoder().decode(bytes);
  }

  readBool(): boolean {
    return this.readVarint() !== 0;
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, length);
    this.pos += length;
    return bytes;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.readVarint();
        break;
      case WIRE_64BIT:
        this.pos += 8;
        break;
      case WIRE_LENGTH:
        this.pos += this.readVarint();
        break;
      case WIRE_32BIT:
        this.pos += 4;
        break;
    }
  }
}

// ============================================================================
// Message Types
// ============================================================================

export interface TransportCommand {
  action: TransportAction;
  seekPosition?: number;
}

export interface SetTrackGain {
  trackId: string;
  gain: number;
}

export interface TransportPosition {
  positionSamples: number;
  isPlaying: boolean;
}

export interface TrackMeter {
  trackId: string;
  peakLeft: number;
  peakRight: number;
}

export interface Meters {
  tracks: TrackMeter[];
}

export interface EngineState {
  bufferUnderruns: number;
  cpuPercent: number;
  latencySamples: number;
}

export interface ErrorMessage {
  severity: number;
  code: string;
  message: string;
}

export type EngineMessage =
  | { type: 'position'; data: TransportPosition }
  | { type: 'meters'; data: Meters }
  | { type: 'state'; data: EngineState }
  | { type: 'error'; data: ErrorMessage };

// ============================================================================
// Encoding
// ============================================================================

function encodeTransportCommand(cmd: TransportCommand): Uint8Array {
  const enc = new ProtoEncoder();
  enc.writeTag(FIELD.TRANSPORT_ACTION, WIRE_VARINT);
  enc.writeVarint(cmd.action);
  if (cmd.seekPosition !== undefined) {
    enc.writeInt64(FIELD.TRANSPORT_SEEK_POSITION, cmd.seekPosition);
  }
  return enc.finish();
}

function encodeSetTrackGain(cmd: SetTrackGain): Uint8Array {
  const enc = new ProtoEncoder();
  enc.writeString(FIELD.GAIN_TRACK_ID, cmd.trackId);
  enc.writeFloat(FIELD.GAIN_VALUE, cmd.gain);
  return enc.finish();
}

/**
 * Encode a client message with length prefix.
 */
export function encodeMessage(
  msg: { type: 'transport'; data: TransportCommand } | { type: 'setTrackGain'; data: SetTrackGain }
): Uint8Array {
  const enc = new ProtoEncoder();

  if (msg.type === 'transport') {
    const inner = encodeTransportCommand(msg.data);
    enc.writeBytes(FIELD.TRANSPORT, inner);
  } else if (msg.type === 'setTrackGain') {
    const inner = encodeSetTrackGain(msg.data);
    enc.writeBytes(FIELD.SET_TRACK_GAIN, inner);
  }

  const payload = enc.finish();

  // Add 4-byte big-endian length prefix
  const result = new Uint8Array(4 + payload.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, payload.length, false); // big-endian
  result.set(payload, 4);

  return result;
}

// ============================================================================
// Decoding
// ============================================================================

function decodeTransportPosition(data: Uint8Array): TransportPosition {
  const dec = new ProtoDecoder((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength));
  let positionSamples = 0;
  let isPlaying = false;

  while (dec.remaining > 0) {
    const tag = dec.readTag();
    if (!tag) break;

    switch (tag.field) {
      case FIELD.POSITION_SAMPLES:
        positionSamples = dec.readInt64();
        break;
      case FIELD.POSITION_IS_PLAYING:
        isPlaying = dec.readBool();
        break;
      default:
        dec.skip(tag.wireType);
    }
  }

  return { positionSamples, isPlaying };
}

function decodeTrackMeter(data: Uint8Array): TrackMeter {
  const dec = new ProtoDecoder((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength));
  let trackId = '';
  let peakLeft = 0;
  let peakRight = 0;

  while (dec.remaining > 0) {
    const tag = dec.readTag();
    if (!tag) break;

    switch (tag.field) {
      case FIELD.METER_TRACK_ID:
        trackId = dec.readString();
        break;
      case FIELD.METER_PEAK_LEFT:
        peakLeft = dec.readFloat();
        break;
      case FIELD.METER_PEAK_RIGHT:
        peakRight = dec.readFloat();
        break;
      default:
        dec.skip(tag.wireType);
    }
  }

  return { trackId, peakLeft, peakRight };
}

function decodeMeters(data: Uint8Array): Meters {
  const dec = new ProtoDecoder((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength));
  const tracks: TrackMeter[] = [];

  while (dec.remaining > 0) {
    const tag = dec.readTag();
    if (!tag) break;

    switch (tag.field) {
      case FIELD.METERS_TRACKS:
        tracks.push(decodeTrackMeter(dec.readBytes()));
        break;
      default:
        dec.skip(tag.wireType);
    }
  }

  return { tracks };
}

function decodeEngineState(data: Uint8Array): EngineState {
  const dec = new ProtoDecoder((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength));
  let bufferUnderruns = 0;
  let cpuPercent = 0;
  let latencySamples = 0;

  while (dec.remaining > 0) {
    const tag = dec.readTag();
    if (!tag) break;

    switch (tag.field) {
      case FIELD.STATE_UNDERRUNS:
        bufferUnderruns = dec.readInt64();
        break;
      case FIELD.STATE_CPU_PERCENT:
        cpuPercent = dec.readVarint();
        break;
      case FIELD.STATE_LATENCY:
        latencySamples = dec.readVarint();
        break;
      default:
        dec.skip(tag.wireType);
    }
  }

  return { bufferUnderruns, cpuPercent, latencySamples };
}

/**
 * Decode a length-prefixed message from the engine.
 */
export function decodeMessage(data: ArrayBuffer): EngineMessage | null {
  if (data.byteLength < 4) return null;

  const view = new DataView(data);
  const length = view.getUint32(0, false); // big-endian

  if (data.byteLength < 4 + length) return null;

  const payload = new Uint8Array(data, 4, length);
  const dec = new ProtoDecoder((payload.buffer as ArrayBuffer).slice(payload.byteOffset, payload.byteOffset + payload.byteLength));

  const tag = dec.readTag();
  if (!tag) return null;

  switch (tag.field) {
    case FIELD.POSITION:
      return { type: 'position', data: decodeTransportPosition(dec.readBytes()) };
    case FIELD.METERS:
      return { type: 'meters', data: decodeMeters(dec.readBytes()) };
    case FIELD.ENGINE_STATE:
      return { type: 'state', data: decodeEngineState(dec.readBytes()) };
    case FIELD.ERROR:
      // Simplified error decoding
      return {
        type: 'error',
        data: { severity: 0, code: 'UNKNOWN', message: 'Error from engine' },
      };
    default:
      return null;
  }
}
