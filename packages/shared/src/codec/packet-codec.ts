/**
 * 12-Byte Binary Header Framing and Packet Codec for EA FESL & Theater Protocols
 */

import { FeslHeader } from '../types/index.js';
import { deserializeKV, serializeKV, KVDeserializeOptions, KVSerializeOptions } from './kv-serializer.js';

export const HEADER_SIZE = 12;

export const FESL_SUBTYPE_RESPONSE_MASK = 0x80000000;
export const FESL_SUBTYPE_EVENT_MASK = 0xC0000000;

export interface DecodedPacket {
  header: FeslHeader;
  payloadString: string;
  payload: Record<string, any>;
  raw: Buffer;
}

/**
 * Checks if a subtype indicates a server response (0x80000000 bit set, but not 0xC0000000 event).
 */
export function isServerResponse(subtype: number): boolean {
  const uSub = subtype >>> 0;
  return ((uSub & 0x80000000) >>> 0) === 0x80000000 && (uSub & 0x40000000) === 0;
}

/**
 * Checks if a subtype indicates a server push event (0xC0000000 bits set).
 */
export function isServerEvent(subtype: number): boolean {
  const uSub = subtype >>> 0;
  return ((uSub & 0xC0000000) >>> 0) === 0xC0000000;
}

/**
 * Extracts sequence number from a subtype value.
 */
export function extractSequence(subtype: number): number {
  return (subtype >>> 0) & 0x3fffffff;
}

/**
 * Constructs a server response subtype from a client sequence number.
 */
export function makeResponseSubtype(seq: number): number {
  return ((seq & 0x3fffffff) | 0x80000000) >>> 0;
}

/**
 * Constructs a server event subtype from an event id.
 */
export function makeEventSubtype(eventId: number): number {
  return ((eventId & 0x3fffffff) | 0xC0000000) >>> 0;
}

/**
 * Encodes a 12-byte header + payload into a binary Buffer.
 */
export function encodePacket(
  subsystem: string,
  subtype: number,
  payload: Record<string, any> | string | Buffer,
  options?: KVSerializeOptions
): Buffer {
  let payloadBuf: Buffer;

  if (Buffer.isBuffer(payload)) {
    payloadBuf = payload;
  } else if (typeof payload === 'string') {
    payloadBuf = Buffer.from(payload, 'utf8');
  } else {
    const serialized = serializeKV(payload, options);
    payloadBuf = Buffer.from(serialized, 'utf8');
  }

  const packetLength = HEADER_SIZE + payloadBuf.length;
  const packetBuf = Buffer.alloc(packetLength);

  // Write 4-byte ASCII subsystem/command
  const cleanSubsystem = subsystem.padEnd(4, ' ').slice(0, 4);
  packetBuf.write(cleanSubsystem, 0, 4, 'ascii');

  // Write 4-byte uint32 Big-Endian subtype / txn / seq
  packetBuf.writeUInt32BE(subtype >>> 0, 4);

  // Write 4-byte uint32 Big-Endian total packet length
  packetBuf.writeUInt32BE(packetLength, 8);

  // Write payload
  if (payloadBuf.length > 0) {
    payloadBuf.copy(packetBuf, HEADER_SIZE);
  }

  return packetBuf;
}

/**
 * Attempts to decode a single packet from a buffer.
 */
export function decodePacket(
  buffer: Buffer,
  options?: KVDeserializeOptions
): DecodedPacket | null {
  if (buffer.length < HEADER_SIZE) {
    return null;
  }

  const subsystem = buffer.toString('ascii', 0, 4).trim();
  const subtype = buffer.readUInt32BE(4);
  const packetLength = buffer.readUInt32BE(8);

  if (buffer.length < packetLength) {
    return null; // Incomplete packet
  }

  const rawPacket = buffer.subarray(0, packetLength);
  const payloadBuf = buffer.subarray(HEADER_SIZE, packetLength);
  const payloadString = payloadBuf.toString('utf8');
  const payload = deserializeKV(payloadString, options);

  return {
    header: {
      subsystem,
      subtype,
      packetLength
    },
    payloadString,
    payload,
    raw: rawPacket
  };
}

/**
 * Stream buffer accumulator that manages fragmented and concatenated TCP packets.
 */
export class PacketFramingBuffer {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Pushes incoming chunk from TCP socket into stream accumulator.
   */
  public push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  /**
   * Pops the next complete packet from the accumulator if available.
   */
  public pop(options?: KVDeserializeOptions): DecodedPacket | null {
    if (this.buffer.length < HEADER_SIZE) {
      return null;
    }

    const packetLength = this.buffer.readUInt32BE(8);

    // Sanity check on minimum packet length
    if (packetLength < HEADER_SIZE) {
      // Corrupt stream: advance by 1 byte to attempt resync
      this.buffer = this.buffer.subarray(1);
      return null;
    }

    if (this.buffer.length < packetLength) {
      return null; // Incomplete, waiting for more data
    }

    const packetBuffer = this.buffer.subarray(0, packetLength);
    this.buffer = this.buffer.subarray(packetLength);

    return decodePacket(packetBuffer, options);
  }

  /**
   * Pops all fully received packets currently in the buffer.
   */
  public popAll(options?: KVDeserializeOptions): DecodedPacket[] {
    const packets: DecodedPacket[] = [];
    let packet: DecodedPacket | null;
    while ((packet = this.pop(options)) !== null) {
      packets.push(packet);
    }
    return packets;
  }

  /**
   * Current unread buffer length in bytes.
   */
  public get length(): number {
    return this.buffer.length;
  }

  /**
   * Resets the internal accumulator buffer.
   */
  public clear(): void {
    this.buffer = Buffer.alloc(0);
  }
}
