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
  HEADER_SIZE,
  serializeKV,
  deserializeKV,
  formatErrorContainer,
  formatFeslDate,
  parseFeslDate,
  FESL_SUBTYPE_RESPONSE_MASK,
  FESL_SUBTYPE_EVENT_MASK
} from '@mohpa/shared';

describe('FESL & Theater Packet Codec & Framing', () => {
  describe('12-Byte Binary Header & Endianness', () => {
    it('correctly encodes 12-byte header with Big-Endian uint32 integers', () => {
      const subsystem = 'fsys';
      const subtype = 0x01020304; // Distinct bytes: 01, 02, 03, 04
      const payload = { TXN: 'Hello', clientType: 'client' };

      const encoded = encodePacket(subsystem, subtype, payload);

      // Verify minimum size
      expect(encoded.length).toBeGreaterThan(HEADER_SIZE);

      // Verify 4-byte ASCII subsystem at offset 0..3
      expect(encoded.toString('ascii', 0, 4)).toBe('fsys');

      // Verify 4-byte Big-Endian uint32 subtype at offset 4..7
      expect(encoded[4]).toBe(0x01);
      expect(encoded[5]).toBe(0x02);
      expect(encoded[6]).toBe(0x03);
      expect(encoded[7]).toBe(0x04);
      expect(encoded.readUInt32BE(4)).toBe(subtype);

      // Verify 4-byte Big-Endian uint32 total packet length at offset 8..11
      const totalLen = encoded.length;
      expect(encoded.readUInt32BE(8)).toBe(totalLen);

      // Verify payload at offset 12..end
      const payloadStr = encoded.toString('utf8', HEADER_SIZE);
      expect(payloadStr).toContain('TXN=Hello\n');
      expect(payloadStr).toContain('clientType=client\n');
    });

    it('pads short subsystem strings to 4 bytes with spaces', () => {
      const encoded = encodePacket('hi', 1, { TXN: 'Test' });
      expect(encoded.toString('ascii', 0, 4)).toBe('hi  ');
    });

    it('truncates subsystem strings longer than 4 bytes to 4 bytes', () => {
      const encoded = encodePacket('verylongsubsystem', 1, { TXN: 'Test' });
      expect(encoded.toString('ascii', 0, 4)).toBe('very');
    });

    it('decodes encoded packet back into structured object with matching header', () => {
      const originalPayload = {
        TXN: 'NuLogin',
        nuid: 'pilot1@mohpa.local',
        returnEncryptedInfo: 1
      };
      const seq = 123456;
      const encoded = encodePacket('acct', seq, originalPayload);

      const decoded = decodePacket(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded?.header.subsystem).toBe('acct');
      expect(decoded?.header.subtype).toBe(seq);
      expect(decoded?.header.packetLength).toBe(encoded.length);
      expect(decoded?.payload.TXN).toBe('NuLogin');
      expect(decoded?.payload.nuid).toBe('pilot1@mohpa.local');
      expect(decoded?.payload.returnEncryptedInfo).toBe(1);
    });

    it('returns null when buffer length is smaller than 12-byte header', () => {
      const tinyBuffer = Buffer.from([0x66, 0x73, 0x79, 0x73, 0x00, 0x00]); // 6 bytes
      expect(decodePacket(tinyBuffer)).toBeNull();
    });

    it('returns null when buffer is smaller than declared packetLength', () => {
      const full = encodePacket('fsys', 1, { TXN: 'Hello', sku: 'BF2142-PC' });
      const truncated = full.subarray(0, full.length - 5);
      expect(decodePacket(truncated)).toBeNull();
    });
  });

  describe('Subtype Bitmasks & Sequence Extraction', () => {
    it('correctly constructs and identifies server response subtypes (0x80000000)', () => {
      const clientSeq = 42;
      const respSubtype = makeResponseSubtype(clientSeq);

      expect((respSubtype & FESL_SUBTYPE_RESPONSE_MASK) >>> 0).toBe(0x80000000);
      expect(isServerResponse(respSubtype)).toBe(true);
      expect(isServerEvent(respSubtype)).toBe(false);
      expect(extractSequence(respSubtype)).toBe(clientSeq);
    });

    it('correctly constructs and identifies server push event subtypes (0xC0000000)', () => {
      const eventId = 7;
      const eventSubtype = makeEventSubtype(eventId);

      expect((eventSubtype & FESL_SUBTYPE_EVENT_MASK) >>> 0).toBe(0xC0000000);
      expect(isServerEvent(eventSubtype)).toBe(true);
      expect(isServerResponse(eventSubtype)).toBe(false);
      expect(extractSequence(eventSubtype)).toBe(eventId);
    });

    it('identifies standard client requests as neither response nor event', () => {
      const clientSubtype = 0x00000005;
      expect(isServerResponse(clientSubtype)).toBe(false);
      expect(isServerEvent(clientSubtype)).toBe(false);
      expect(extractSequence(clientSubtype)).toBe(5);
    });
  });

  describe('PacketFramingBuffer Stream Reassembly', () => {
    it('buffers partial packets and pops complete packet when rest of data arrives', () => {
      const buffer = new PacketFramingBuffer();
      const packet = encodePacket('fsys', 1, { TXN: 'Ping', TID: '12345' });

      // Feed partial header (8 bytes)
      buffer.push(packet.subarray(0, 8));
      expect(buffer.pop()).toBeNull();
      expect(buffer.length).toBe(8);

      // Feed rest of header and partial payload (6 more bytes)
      buffer.push(packet.subarray(8, 14));
      expect(buffer.pop()).toBeNull();

      // Feed remaining payload
      buffer.push(packet.subarray(14));
      const popped = buffer.pop();
      expect(popped).not.toBeNull();
      expect(popped?.header.subsystem).toBe('fsys');
      expect(popped?.payload.TXN).toBe('Ping');
      expect(String(popped?.payload.TID)).toBe('12345');
      expect(buffer.length).toBe(0);
    });

    it('extracts multiple concatenated packets in one chunk via popAll()', () => {
      const buffer = new PacketFramingBuffer();
      const p1 = encodePacket('fsys', 1, { TXN: 'Hello' });
      const p2 = encodePacket('acct', 2, { TXN: 'NuLogin', nuid: 'test' });
      const p3 = encodePacket('rank', 3, { TXN: 'GetStats', ownerId: 101 });

      const combined = Buffer.concat([p1, p2, p3]);
      buffer.push(combined);

      const all = buffer.popAll();
      expect(all).toHaveLength(3);
      expect(all[0].header.subsystem).toBe('fsys');
      expect(all[0].payload.TXN).toBe('Hello');
      expect(all[1].header.subsystem).toBe('acct');
      expect(all[1].payload.TXN).toBe('NuLogin');
      expect(all[2].header.subsystem).toBe('rank');
      expect(all[2].payload.TXN).toBe('GetStats');
      expect(buffer.length).toBe(0);
    });

    it('handles stream fragmented into 1-byte chunks seamlessly', () => {
      const buffer = new PacketFramingBuffer();
      const p1 = encodePacket('CONN', 1, { TID: '1', LKEY: 'session-token-123' });
      const p2 = encodePacket('GLST', 2, { TID: '2', LID: 1 });

      const stream = Buffer.concat([p1, p2]);
      const collected: any[] = [];

      for (let i = 0; i < stream.length; i++) {
        buffer.push(stream.subarray(i, i + 1));
        const pkt = buffer.pop();
        if (pkt) {
          collected.push(pkt);
        }
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].header.subsystem).toBe('CONN');
      expect(collected[0].payload.LKEY).toBe('session-token-123');
      expect(collected[1].header.subsystem).toBe('GLST');
      expect(collected[1].payload.LID).toBe(1);
    });

    it('resyncs on invalid / corrupt packetLength (< HEADER_SIZE)', () => {
      const buffer = new PacketFramingBuffer();
      // Corrupt 12-byte header declaring packet length of 4 bytes (< 12)
      const corruptHeader = Buffer.alloc(12);
      corruptHeader.write('corz', 0, 4, 'ascii');
      corruptHeader.writeUInt32BE(1, 4);
      corruptHeader.writeUInt32BE(4, 8); // Corrupt length

      buffer.push(corruptHeader);
      // pop() detects packetLength < HEADER_SIZE and advances buffer by 1 byte
      expect(buffer.pop()).toBeNull();
      expect(buffer.length).toBe(11);
    });

    it('clears internal buffer state properly', () => {
      const buffer = new PacketFramingBuffer();
      buffer.push(Buffer.from('incomplete data'));
      expect(buffer.length).toBeGreaterThan(0);
      buffer.clear();
      expect(buffer.length).toBe(0);
    });
  });
});

describe('KV Serializer / Deserializer', () => {
  describe('Flat Key-Value Pairs', () => {
    it('serializes flat objects into newline-delimited ASCII strings', () => {
      const obj = {
        TXN: 'Hello',
        sku: 'BF2142-PC',
        locale: 'en_US',
        clientType: 'client'
      };

      const serialized = serializeKV(obj);
      expect(serialized).toBe(
        'TXN=Hello\nsku=BF2142-PC\nlocale=en_US\nclientType=client\n'
      );
    });

    it('deserializes newline-delimited ASCII strings into typed object', () => {
      const text = 'TXN=Hello\nsku=BF2142-PC\nlocale=en_US\nclientType=client\n';
      const deserialized = deserializeKV(text);

      expect(deserialized.TXN).toBe('Hello');
      expect(deserialized.sku).toBe('BF2142-PC');
      expect(deserialized.locale).toBe('en_US');
      expect(deserialized.clientType).toBe('client');
    });

    it('ignores comments starting with # and blank lines', () => {
      const text = '# FESL response comment\n\nTXN=Ping\n# another comment\nTID=999\n';
      const deserialized = deserializeKV(text);

      expect(deserialized.TXN).toBe('Ping');
      expect(deserialized.TID).toBe(999);
      expect(Object.keys(deserialized)).toHaveLength(2);
    });
  });

  describe('Multi-dimensional Arrays & Dotted Paths', () => {
    it('serializes primitive array with count marker', () => {
      const obj = {
        TXN: 'NuGetPersonas',
        personas: ['Vanguard', 'SpyMaster', 'TitanLeader']
      };

      const serialized = serializeKV(obj);
      expect(serialized).toContain('personas.[]=3\n');
      expect(serialized).toContain('personas.0=Vanguard\n');
      expect(serialized).toContain('personas.1=SpyMaster\n');
      expect(serialized).toContain('personas.2=TitanLeader\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.TXN).toBe('NuGetPersonas');
      expect(Array.isArray(parsed.personas)).toBe(true);
      expect(parsed.personas).toEqual(['Vanguard', 'SpyMaster', 'TitanLeader']);
    });

    it('serializes and deserializes array of complex objects', () => {
      const obj = {
        TXN: 'GetPingSites',
        minPingSitesToPing: 2,
        pingSites: [
          { addr: '127.0.0.1', port: 18270, name: 'Local Gateway', type: 0 },
          { addr: '10.0.0.1', port: 18270, name: 'EU Cluster', type: 1 }
        ]
      };

      const serialized = serializeKV(obj);
      expect(serialized).toContain('pingSites.[]=2\n');
      expect(serialized).toContain('pingSites.0.addr=127.0.0.1\n');
      expect(serialized).toContain('pingSites.0.port=18270\n');
      expect(serialized).toContain('pingSites.0.name="Local Gateway"\n');
      expect(serialized).toContain('pingSites.1.addr=10.0.0.1\n');
      expect(serialized).toContain('pingSites.1.name="EU Cluster"\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.minPingSitesToPing).toBe(2);
      expect(Array.isArray(parsed.pingSites)).toBe(true);
      expect(parsed.pingSites).toHaveLength(2);
      expect(parsed.pingSites[0].addr).toBe('127.0.0.1');
      expect(parsed.pingSites[0].port).toBe(18270);
      expect(parsed.pingSites[0].name).toBe('Local Gateway');
      expect(parsed.pingSites[1].name).toBe('EU Cluster');
    });

    it('handles nested multi-tier objects', () => {
      const obj = {
        server: {
          config: {
            rules: {
              ff: 1,
              maxPlayers: 64
            }
          }
        }
      };

      const serialized = serializeKV(obj);
      expect(serialized).toContain('server.config.rules.ff=1\n');
      expect(serialized).toContain('server.config.rules.maxPlayers=64\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.server.config.rules.ff).toBe(1);
      expect(parsed.server.config.rules.maxPlayers).toBe(64);
    });

    it('correctly handles empty arrays', () => {
      const obj = {
        TXN: 'GetSubAccounts',
        subAccounts: []
      };

      const serialized = serializeKV(obj);
      expect(serialized).toContain('subAccounts.[]=0\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.subAccounts).toEqual([]);
    });
  });

  describe('Escaping, Quotes, URL-Encoding & Types', () => {
    it('escapes and unescapes quotes, newlines, tabs, and backslashes', () => {
      const input = {
        message: 'Line 1\nLine 2\tTabbed "Quoted" and \\Backslash\\'
      };

      const serialized = serializeKV(input, { quoteStrings: true });
      expect(serialized).toContain('message="Line 1\\nLine 2\\tTabbed \\"Quoted\\" and \\\\Backslash\\\\"\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.message).toBe('Line 1\nLine 2\tTabbed "Quoted" and \\Backslash\\');
    });

    it('decodes percent-encoded URLs and strings', () => {
      const rawKV = 'TXN=NuLogin\nencryptedInfo="User%20Name%20With%20Spaces%2BExtra"\n';
      const parsed = deserializeKV(rawKV);

      expect(parsed.TXN).toBe('NuLogin');
      expect(parsed.encryptedInfo).toBe('User Name With Spaces+Extra');
    });

    it('parses numeric values and preserves negative numbers and zeroes', () => {
      const rawKV = 'intPos=42\nintZero=0\nintNeg=-100\nfloatVal=3.14159\nleadZeroString=00123\n';
      const parsed = deserializeKV(rawKV);

      expect(parsed.intPos).toBe(42);
      expect(parsed.intZero).toBe(0);
      expect(parsed.intNeg).toBe(-100);
      expect(parsed.floatVal).toBe(3.14159);
      expect(parsed.leadZeroString).toBe('00123'); // Preserved as string due to leading zeros
    });

    it('parses booleans when parseBooleans is true', () => {
      const rawKV = 'active=true\ndisabled=false\nother=TRUE\n';
      const parsed = deserializeKV(rawKV, { parseBooleans: true });

      expect(parsed.active).toBe(true);
      expect(parsed.disabled).toBe(false);
      expect(parsed.other).toBe(true);
    });
  });

  describe('Error Containers & Helpers', () => {
    it('formats single errorContainer correctly', () => {
      const container = formatErrorContainer([
        { fieldName: 'password', fieldError: 'Invalid password', fieldErrorCode: 1000 }
      ]);

      const serialized = serializeKV(container);
      expect(serialized).toContain('errorContainer.[]=1\n');
      expect(serialized).toContain('errorContainer.0.fieldName=password\n');
      expect(serialized).toContain('errorContainer.0.fieldError="Invalid password"\n');

      const parsed = deserializeKV(serialized);
      expect(Array.isArray(parsed.errorContainer)).toBe(true);
      expect(parsed.errorContainer[0].fieldName).toBe('password');
      expect(parsed.errorContainer[0].fieldError).toBe('Invalid password');
    });

    it('formats multiple errorContainer items correctly', () => {
      const container = formatErrorContainer([
        { fieldName: 'name', fieldError: 'Name required', fieldErrorCode: 1001 },
        { fieldName: 'email', fieldError: 'Email invalid', fieldErrorCode: 1002 }
      ]);

      const serialized = serializeKV(container);
      expect(serialized).toContain('errorContainer.[]=2\n');
      expect(serialized).toContain('errorContainer.0.fieldName=name\n');
      expect(serialized).toContain('errorContainer.1.fieldName=email\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.errorContainer).toHaveLength(2);
      expect(parsed.errorContainer[0].fieldName).toBe('name');
      expect(parsed.errorContainer[1].fieldName).toBe('email');
    });

    it('formats empty errorContainer as errorContainer=[]', () => {
      const container = formatErrorContainer([]);
      const serialized = serializeKV(container);
      expect(serialized).toBe('errorContainer=[]\n');

      const parsed = deserializeKV(serialized);
      expect(parsed.errorContainer).toEqual([]);
    });
  });

  describe('FESL Date Formatting', () => {
    it('formats and parses FESL dates accurately', () => {
      const date = new Date(Date.UTC(2026, 8, 2, 13, 45, 30));
      const formatted = formatFeslDate(date);
      expect(formatted).toMatch(/^[A-Z][a-z]{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} UTC$/);

      const parsed = parseFeslDate(formatted);
      expect(parsed).not.toBeNull();
      expect(parsed?.getUTCFullYear()).toBe(2026);
      expect(parsed?.getUTCMonth()).toBe(8); // September
      expect(parsed?.getUTCDate()).toBe(2);
    });
  });
});
