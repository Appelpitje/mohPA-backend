/**
 * GameSpy GOA enctype2 (gutil.c crypt_*). Encrypt == decrypt (XOR keystream).
 * Used by 2004 ServerListReadList when the client sends \enctype\2\.
 */

const CRYPT_HEIGHT = 16;
const CRYPT_TABLE_SIZE = 256;
const NUM_KEYSETUP_PASSES = 2;
const NWORDS = 16;
const CRYPT_MIN_LEAF_NUM = 1 << CRYPT_HEIGHT;
const KEYDATA_BYTES = NWORDS * 4;

export const MOHPA_SECKEY = 'S6v8Lm';
const KEYLEN_XOR = 0xec;

function u32(n: number): number {
  return n >>> 0;
}

function rot8(x: number): number {
  return u32((x << 8) | (x >>> 24));
}

function rot24(x: number): number {
  return u32((x << 24) | (x >>> 8));
}

export class Enctype2Crypt {
  F = new Uint32Array(CRYPT_TABLE_SIZE);
  xStack = new Uint32Array(CRYPT_HEIGHT);
  yStack = new Uint32Array(CRYPT_HEIGHT);
  zStack = new Uint32Array(CRYPT_HEIGHT);
  index = 0;
  x = 0;
  y = 0;
  z = 0;
  keydata = Buffer.alloc(KEYDATA_BYTES);
  keyOffset = -1;

  private f(): void {
    let { x, y, z } = this;
    y = rot24(y);
    x ^= this.F[x & 0xff];
    y ^= this.F[y & 0xff];
    y = rot24(y);
    x = rot8(x);
    x ^= this.F[x & 0xff];
    y ^= this.F[y & 0xff];
    x = rot8(x);
    z = u32(z + z);
    this.x = u32(x);
    this.y = u32(y);
    this.z = u32(z);
  }

  private g(): void {
    let { x, y, z } = this;
    x = u32(~x);
    x = rot24(x);
    x ^= this.F[x & 0xff];
    y ^= this.F[y & 0xff];
    x = rot24(x);
    y = rot8(y);
    x ^= this.F[x & 0xff];
    y ^= this.F[y & 0xff];
    y = rot8(y);
    z = u32(z + (z + 1));
    this.x = u32(x);
    this.y = u32(y);
    this.z = u32(z);
  }

  private d(): void {
    this.x = u32(this.x + this.z);
    this.y = u32(this.y + this.x);
    this.x = u32(this.x + this.y);
  }

  seek(treeNum: number, leafNum: number): void {
    let i = 1 << (CRYPT_HEIGHT - 1);
    this.x = u32(treeNum);
    this.y = 0;
    this.z = 1;
    this.index = 0;

    while (i > 0) {
      this.d();
      if (i & leafNum) {
        this.g();
      } else {
        this.xStack[this.index] = this.x;
        this.yStack[this.index] = this.y;
        this.zStack[this.index] = this.z;
        this.index += 1;
        this.f();
      }
      i >>= 1;
    }
  }

  encryptWords(dest: Uint32Array): void {
    let index = this.index;
    let x = this.x;
    let y = this.y;
    let z = this.z;
    const F = this.F;

    const applyF = () => {
      y = rot24(y);
      x ^= F[x & 0xff];
      y ^= F[y & 0xff];
      y = rot24(y);
      x = rot8(x);
      x ^= F[x & 0xff];
      y ^= F[y & 0xff];
      x = rot8(x);
      x = u32(x);
      y = u32(y);
      z = u32(z + z);
    };
    const applyG = () => {
      x = u32(~x);
      x = rot24(x);
      x ^= F[x & 0xff];
      y ^= F[y & 0xff];
      x = rot24(x);
      y = rot8(y);
      x ^= F[x & 0xff];
      y ^= F[y & 0xff];
      y = rot8(y);
      x = u32(x);
      y = u32(y);
      z = u32(z + (z + 1));
    };
    const applyD = () => {
      x = u32(x + z);
      y = u32(y + x);
      x = u32(x + y);
    };

    for (let n = 0; n < dest.length; n++) {
      while (z < CRYPT_MIN_LEAF_NUM) {
        applyD();
        this.xStack[index] = x;
        this.yStack[index] = y;
        this.zStack[index] = z;
        index += 1;
        applyF();
      }
      dest[n] = u32(x ^ y);
      index -= 1;
      if (index < 0) index = 0;
      x = this.xStack[index];
      y = this.yStack[index];
      z = this.zStack[index];
      applyG();
    }
    this.index = index;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  init(key: Buffer): void {
    const F = this.F;
    F.fill(0);
    this.keyOffset = -1;

    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < CRYPT_TABLE_SIZE; i++) {
        F[i] = u32(F[i] * CRYPT_TABLE_SIZE + i);
      }
      let index = j;
      for (let k = 0; k < NUM_KEYSETUP_PASSES; k++) {
        for (let i = 0; i < CRYPT_TABLE_SIZE; i++) {
          index = (index + key[i % key.length] + F[i]) & (CRYPT_TABLE_SIZE - 1);
          const tmp = F[i];
          F[i] = F[index];
          F[index] = tmp;
        }
      }
    }
    for (let i = 0; i < CRYPT_TABLE_SIZE; i++) {
      F[i] ^= i;
    }
    this.seek(0, 0);
  }

  docrypt(data: Buffer): void {
    const words = new Uint32Array(NWORDS);
    for (let i = 0; i < data.length; i++) {
      if (this.keyOffset < 0 || this.keyOffset >= KEYDATA_BYTES - 1) {
        this.encryptWords(words);
        for (let w = 0; w < NWORDS; w++) {
          this.keydata.writeUInt32LE(words[w], w * 4);
        }
        this.keyOffset = 0;
      }
      data[i] ^= this.keydata[this.keyOffset];
      this.keyOffset += 1;
    }
  }
}

/** Client-side unwrap of an enctype2 master payload (gserverlist.c ServerListReadList). */
export function unwrapEnctype2(packet: Buffer, seckey: string): Buffer | null {
  if (packet.length < 1) return null;
  const keylen = packet[0] ^ KEYLEN_XOR;
  if (keylen < 1 || packet.length <= keylen) return null;
  const key = Buffer.from(packet.subarray(1, 1 + keylen));
  for (let i = 0; i < seckey.length && i < keylen; i++) {
    key[i] ^= seckey.charCodeAt(i);
  }
  const body = Buffer.from(packet.subarray(1 + keylen));
  const crypt = new Enctype2Crypt();
  crypt.init(key);
  crypt.docrypt(body);
  return body;
}

export function wrapEnctype2(plaintext: Buffer, seckey: string, rawKey: Buffer): Buffer {
  if (rawKey.length < 1 || rawKey.length > 255) {
    throw new Error('enctype2 raw key must be 1-255 bytes');
  }
  const header = Buffer.alloc(1 + rawKey.length);
  header[0] = rawKey.length ^ KEYLEN_XOR;
  for (let i = 0; i < rawKey.length; i++) {
    const mix = i < seckey.length ? seckey.charCodeAt(i) : 0;
    header[1 + i] = rawKey[i] ^ mix;
  }
  const body = Buffer.from(plaintext);
  const crypt = new Enctype2Crypt();
  crypt.init(rawKey);
  crypt.docrypt(body);
  return Buffer.concat([header, body]);
}

export function emptyEnctype2List(seckey: string, rawKey?: Buffer): Buffer {
  const key = rawKey ?? Buffer.from(seckey, 'ascii');
  return wrapEnctype2(Buffer.from('\\final\\', 'ascii'), seckey, key);
}
