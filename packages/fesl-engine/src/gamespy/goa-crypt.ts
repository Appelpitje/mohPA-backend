/**
 * GameSpy GOA cipher (sb_crypt.c). Encrypt == decrypt-inverse via GOAEncryptByte.
 */

const u8 = (n: number): number => n & 0xff;

export class GoaCrypt {
  cards = new Uint8Array(256);
  rotor = 0;
  ratchet = 0;
  avalanche = 0;
  lastPlain = 0;
  lastCipher = 0;

  private keyrand(
    limit: number,
    userKey: Uint8Array,
    rsum: { v: number },
    keypos: { v: number }
  ): number {
    if (!limit) return 0;
    let retryLimiter = 0;
    let mask = 1;
    while (mask < limit) {
      mask = (mask << 1) + 1;
    }
    let u = 0;
    do {
      rsum.v = u8(this.cards[rsum.v] + userKey[keypos.v++]);
      if (keypos.v >= userKey.length) {
        keypos.v = 0;
        rsum.v = u8(rsum.v + userKey.length);
      }
      u = mask & rsum.v;
      if (++retryLimiter > 11) {
        u %= limit;
      }
    } while (u > limit);
    return u8(u);
  }

  init(key: Uint8Array): void {
    if (key.length < 1) {
      this.rotor = 1;
      this.ratchet = 3;
      this.avalanche = 5;
      this.lastPlain = 7;
      this.lastCipher = 11;
      for (let i = 0, j = 255; i < 256; i++, j--) {
        this.cards[i] = j;
      }
      return;
    }
    for (let i = 0; i < 256; i++) {
      this.cards[i] = i;
    }
    const rsum = { v: 0 };
    const keypos = { v: 0 };
    for (let i = 255; i >= 0; i--) {
      const toswap = this.keyrand(i, key, rsum, keypos);
      const swaptemp = this.cards[i];
      this.cards[i] = this.cards[toswap];
      this.cards[toswap] = swaptemp;
    }
    this.rotor = this.cards[1];
    this.ratchet = this.cards[3];
    this.avalanche = this.cards[5];
    this.lastPlain = this.cards[7];
    this.lastCipher = this.cards[rsum.v];
  }

  encryptByte(b: number): number {
    b = u8(b);
    this.ratchet = u8(this.ratchet + this.cards[this.rotor++]);
    const swaptemp = this.cards[this.lastCipher];
    this.cards[this.lastCipher] = this.cards[this.ratchet];
    this.cards[this.ratchet] = this.cards[this.lastPlain];
    this.cards[this.lastPlain] = this.cards[this.rotor];
    this.cards[this.rotor] = swaptemp;
    this.avalanche = u8(this.avalanche + this.cards[swaptemp]);
    this.lastCipher = u8(
      b ^
        this.cards[u8(this.cards[this.avalanche] + this.cards[this.rotor])] ^
        this.cards[this.cards[u8(this.cards[this.lastPlain] + this.cards[this.lastCipher] + this.cards[this.ratchet])]]
    );
    this.lastPlain = b;
    return this.lastCipher;
  }

  decryptByte(b: number): number {
    b = u8(b);
    this.ratchet = u8(this.ratchet + this.cards[this.rotor++]);
    const swaptemp = this.cards[this.lastCipher];
    this.cards[this.lastCipher] = this.cards[this.ratchet];
    this.cards[this.ratchet] = this.cards[this.lastPlain];
    this.cards[this.lastPlain] = this.cards[this.rotor];
    this.cards[this.rotor] = swaptemp;
    this.avalanche = u8(this.avalanche + this.cards[swaptemp]);
    this.lastPlain = u8(
      b ^
        this.cards[u8(this.cards[this.avalanche] + this.cards[this.rotor])] ^
        this.cards[this.cards[u8(this.cards[this.lastPlain] + this.cards[this.lastCipher] + this.cards[this.ratchet])]]
    );
    this.lastCipher = b;
    return this.lastPlain;
  }

  encrypt(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      data[i] = this.encryptByte(data[i]);
    }
  }

  decrypt(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      data[i] = this.decryptByte(data[i]);
    }
  }
}

export const LIST_CHALLENGE_LEN = 8;

/** Client-side InitCryptKey (sb_serverlist.c). Mutates a copy of the client challenge. */
export function mixListChallenge(clientChallenge: Buffer, serverKey: Buffer, seckey: string): Buffer {
  const challenge = Buffer.from(clientChallenge);
  const sec = Buffer.from(seckey, 'ascii');
  if (sec.length < 1 || challenge.length < LIST_CHALLENGE_LEN) {
    throw new Error('invalid challenge/seckey');
  }
  for (let i = 0; i < serverKey.length; i++) {
    const idx = (i * sec[i % sec.length]) % LIST_CHALLENGE_LEN;
    challenge[idx] = u8(challenge[idx] ^ u8(challenge[i % LIST_CHALLENGE_LEN] ^ serverKey[i]));
  }
  return challenge;
}
