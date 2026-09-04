import { describe, it, expect } from 'vitest';
import {
  encodePacket,
  decodePacket,
  PacketFramingBuffer,
  isServerResponse,
  isServerEvent,
  makeResponseSubtype,
  makeEventSubtype,
  extractSequence,
  HEADER_SIZE
} from '../src/codec/packet-codec.js';

describe('Packet Codec & Framing', () => {
  it('should encode and decode a 12-byte header with KV payload', () => {
    const subsystem = 'fsys';
    const subtype = 0x00000001;
    const payload = { TXN: 'Hello', clientType: 'client' };

    const encoded = encodePacket(subsystem, subtype, payload);
    expect(encoded.length).toBeGreaterThan(HEADER_SIZE);
    expect(encoded.toString('ascii', 0, 4)).toBe('fsys');
    expect(encoded.readUInt32BE(4)).toBe(subtype);
    expect(encoded.readUInt32BE(8)).toBe(encoded.length);

    const decoded = decodePacket(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.header.subsystem).toBe('fsys');
    expect(decoded?.header.subtype).toBe(subtype);
    expect(decoded?.header.packetLength).toBe(encoded.length);
    expect(decoded?.payload.TXN).toBe('Hello');
    expect(decoded?.payload.clientType).toBe('client');
  });

  it('should handle response and event subtype masks', () => {
    const seq = 42;
    const respSubtype = makeResponseSubtype(seq);
    expect(isServerResponse(respSubtype)).toBe(true);
    expect(extractSequence(respSubtype)).toBe(seq);

    const eventSubtype = makeEventSubtype(1);
    expect(isServerEvent(eventSubtype)).toBe(true);
  });


  it('should handle stream fragmentation and concatenated packets in PacketFramingBuffer', () => {
    const queue = new PacketFramingBuffer();

    const pkt1 = encodePacket('fsys', 1, { TXN: 'Ping' });
    const pkt2 = encodePacket('acct', 2, { TXN: 'NuLogin', nuid: 'testuser' });

    const combined = Buffer.concat([pkt1, pkt2]);

    // Feed in 2 chunks (fragmented across packet boundary)
    const splitPoint = Math.floor(pkt1.length / 2);
    const chunk1 = combined.subarray(0, splitPoint);
    const chunk2 = combined.subarray(splitPoint);

    queue.push(chunk1);
    expect(queue.pop()).toBeNull(); // Incomplete

    queue.push(chunk2);
    const packets = queue.popAll();
    expect(packets).toHaveLength(2);
    expect(packets[0].header.subsystem).toBe('fsys');
    expect(packets[0].payload.TXN).toBe('Ping');
    expect(packets[1].header.subsystem).toBe('acct');
    expect(packets[1].payload.TXN).toBe('NuLogin');
  });
});
