import { describe, it, expect } from 'vitest';
import {
  Enctype2Crypt,
  wrapEnctype2,
  unwrapEnctype2,
  emptyEnctype2List,
  MOHPA_SECKEY,
} from '../src/gamespy/enctype2.js';

describe('GameSpy enctype2', () => {
  it('roundtrips XOR keystream', () => {
    const key = Buffer.from('S6v8Lm', 'ascii');
    const plain = Buffer.from('\\final\\', 'ascii');
    const a = Buffer.from(plain);
    const b = Buffer.from(plain);
    const c1 = new Enctype2Crypt();
    c1.init(key);
    c1.docrypt(a);
    expect(a.equals(plain)).toBe(false);
    const c2 = new Enctype2Crypt();
    c2.init(key);
    c2.docrypt(a);
    expect(a.equals(plain)).toBe(true);
    const c3 = new Enctype2Crypt();
    c3.init(key);
    c3.docrypt(b);
    const c4 = new Enctype2Crypt();
    c4.init(key);
    c4.docrypt(b);
    expect(b.equals(plain)).toBe(true);
  });

  it('client unwrap recovers \\final\\ from a wrapped empty list', () => {
    const rawKey = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
    const packet = wrapEnctype2(Buffer.from('\\final\\', 'ascii'), MOHPA_SECKEY, rawKey);
    expect(packet[0]).toBe(6 ^ 0xec);
    expect(packet.toString('ascii').includes('\\final\\')).toBe(false);
    const body = unwrapEnctype2(packet, MOHPA_SECKEY);
    expect(body?.toString('ascii')).toBe('\\final\\');
  });

  it('first byte of an empty list is not plaintext backslash (keylen 176 trap)', () => {
    const packet = emptyEnctype2List(MOHPA_SECKEY);
    expect(packet[0]).not.toBe(0x5c);
    expect(packet.length).toBeGreaterThan(7);
    expect(unwrapEnctype2(packet, MOHPA_SECKEY)?.toString('ascii')).toBe('\\final\\');
  });
});
