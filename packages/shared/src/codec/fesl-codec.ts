import { FeslPacket } from './fesl-packet.js';
import { formatKvPayload } from './kv-serializer.js';

export const FESL_HEADER_SIZE = 12;

/**
 * Encodes a FeslPacket or packet data into a wire Buffer (12-byte binary header + ASCII KV payload).
 */
export function encodePacket(
  packet: FeslPacket | { subsystem: string; packetType: number; payload: Record<string, any> | string; rawPayload?: string }
): Buffer {
  let rawPayload: string;
  if (packet instanceof FeslPacket) {
    rawPayload = packet.rawPayload;
  } else if (packet.rawPayload !== undefined) {
    rawPayload = packet.rawPayload;
  } else if (typeof packet.payload === 'string') {
    rawPayload = packet.payload;
  } else {
    rawPayload = formatKvPayload(packet.payload);
  }

  const payloadBuffer = Buffer.from(rawPayload, 'utf8');
  const totalLength = FESL_HEADER_SIZE + payloadBuffer.length;
  const headerBuffer = Buffer.allocUnsafe(FESL_HEADER_SIZE);

  // Bytes 0-3: Subsystem (4 chars ASCII, e.g. 'fsys', 'acct')
  const subsystem = (packet.subsystem || 'fsys').padEnd(4, ' ').substring(0, 4);
  headerBuffer.write(subsystem, 0, 4, 'ascii');

  // Bytes 4-7: Packet type / sequence number / transaction ID (uint32 BE)
  headerBuffer.writeUInt32BE(packet.packetType >>> 0, 4);

  // Bytes 8-11: Total packet size (uint32 BE)
  headerBuffer.writeUInt32BE(totalLength >>> 0, 8);

  return Buffer.concat([headerBuffer, payloadBuffer], totalLength);
}

/**
 * Attempts to decode a single FESL packet from a Buffer.
 * Returns null if fewer than 12 bytes or incomplete packet payload is present.
 */
export function decodePacket(buffer: Buffer): { packet: FeslPacket; bytesRead: number } | null {
  if (buffer.length < FESL_HEADER_SIZE) {
    return null;
  }

  const totalLength = buffer.readUInt32BE(8);

  // Sanity check: packet length cannot be smaller than header
  if (totalLength < FESL_HEADER_SIZE) {
    throw new Error(`Invalid FESL packet length: ${totalLength} (minimum is ${FESL_HEADER_SIZE})`);
  }

  // Not enough data in buffer yet for full packet
  if (buffer.length < totalLength) {
    return null;
  }

  const subsystem = buffer.toString('ascii', 0, 4).trim();
  const packetType = buffer.readUInt32BE(4);
  const payloadBuffer = buffer.subarray(FESL_HEADER_SIZE, totalLength);
  const rawPayload = payloadBuffer.toString('utf8');

  const packet = new FeslPacket({
    subsystem,
    packetType,
    rawPayload,
    length: totalLength,
  });

  return {
    packet,
    bytesRead: totalLength,
  };
}

/**
 * Decodes all complete packets in the buffer and returns them along with any remaining bytes.
 */
export function decodeAllPackets(buffer: Buffer): { packets: FeslPacket[]; remaining: Buffer } {
  const packets: FeslPacket[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const slice = buffer.subarray(offset);
    const result = decodePacket(slice);
    if (!result) {
      break;
    }
    packets.push(result.packet);
    offset += result.bytesRead;
  }

  const remaining = offset === 0 ? buffer : buffer.subarray(offset);
  return { packets, remaining };
}
