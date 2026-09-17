import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { Duplex } from 'node:stream';

/**
 * Pure TypeScript RC4 (ARC4) stream cipher implementation.
 * Required because modern OpenSSL (3.0+) removed native RC4 support.
 */
export class Rc4Cipher {
  private s = new Uint8Array(256);
  private i = 0;
  private j = 0;

  constructor(key: Buffer) {
    for (let k = 0; k < 256; k++) {
      this.s[k] = k;
    }
    let j = 0;
    for (let k = 0; k < 256; k++) {
      j = (j + this.s[k] + key[k % key.length]) & 0xff;
      const tmp = this.s[k];
      this.s[k] = this.s[j];
      this.s[j] = tmp;
    }
    this.i = 0;
    this.j = 0;
  }

  public update(data: Buffer): Buffer {
    const out = Buffer.allocUnsafe(data.length);
    for (let k = 0; k < data.length; k++) {
      this.i = (this.i + 1) & 0xff;
      this.j = (this.j + this.s[this.i]) & 0xff;
      const tmp = this.s[this.i];
      this.s[this.i] = this.s[this.j];
      this.s[this.j] = tmp;
      out[k] = data[k] ^ this.s[(this.s[this.i] + this.s[this.j]) & 0xff];
    }
    return out;
  }
}

/**
 * SSL 2.0 Message Type constants (RFC 6101 / Netscape SSL 2.0).
 */
export const SSL2_MT = {
  ERROR: 0,
  CLIENT_HELLO: 1,
  CLIENT_MASTER_KEY: 2,
  CLIENT_FINISHED: 3,
  SERVER_HELLO: 4,
  SERVER_VERIFY: 5,
  SERVER_FINISHED: 6,
  REQUEST_CERTIFICATE: 7,
  CLIENT_CERTIFICATE: 8,
} as const;

export interface Ssl2SocketOptions {
  rawSocket: net.Socket;
  certDer: Buffer;
  privateKeyPem: string;
  initialChunk?: Buffer;
}

/**
 * Full SSL 2.0 transparent duplex socket wrapper for legacy EA DirtySDK clients (MOHPA 2004).
 * Handles the 2-round-trip SSLv2 handshake and stream encryption (RC4-128 + MD5 MAC).
 */
export class Ssl2Socket extends Duplex {
  public readonly rawSocket: net.Socket;
  public readonly remoteAddress: string;
  public readonly remotePort: number;

  private state: 'WAIT_CLIENT_HELLO' | 'WAIT_CLIENT_MASTER_KEY' | 'WAIT_CLIENT_FINISHED' | 'ESTABLISHED' = 'WAIT_CLIENT_HELLO';
  private inBuffer: Buffer = Buffer.alloc(0);
  private challenge?: Buffer;
  private connId?: Buffer;
  private masterKey?: Buffer;
  private readKey?: Buffer;
  private writeKey?: Buffer;
  private readCipher?: Rc4Cipher;
  private writeCipher?: Rc4Cipher;
  private readSeq = 0;
  private writeSeq = 0;
  private certDer: Buffer;
  private privateKeyPem: string;

  constructor(options: Ssl2SocketOptions) {
    super();
    this.rawSocket = options.rawSocket;
    this.certDer = options.certDer;
    this.privateKeyPem = options.privateKeyPem;
    this.remoteAddress = options.rawSocket.remoteAddress || '127.0.0.1';
    this.remotePort = options.rawSocket.remotePort || 0;

    this.rawSocket.on('data', (chunk: Buffer) => this.handleRawData(chunk));
    this.rawSocket.on('error', (err: Error) => this.emit('error', err));
    this.rawSocket.on('close', (hadError: boolean) => this.emit('close', hadError));
    this.rawSocket.on('end', () => this.emit('end'));

    if (options.initialChunk && options.initialChunk.length > 0) {
      this.handleRawData(options.initialChunk);
    }
  }

  public override destroy(error?: Error): this {
    this.rawSocket.destroy(error);
    super.destroy(error);
    return this;
  }

  public setNoDelay(noDelay?: boolean): this {
    this.rawSocket.setNoDelay(noDelay);
    return this;
  }

  public setKeepAlive(enable?: boolean, initialDelay?: number): this {
    this.rawSocket.setKeepAlive(enable, initialDelay);
    return this;
  }

  public setTimeout(timeout: number, callback?: () => void): this {
    this.rawSocket.setTimeout(timeout, callback);
    return this;
  }

  public override _read(_size: number): void {
    // Inbound data is pushed reactively in handleRawData()
  }

  public override _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.state !== 'ESTABLISHED' || !this.writeCipher || !this.writeKey) {
      callback(new Error('SSL 2.0 session not yet established'));
      return;
    }

    const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);

    // Split into chunks if payload exceeds max SSL2 record length (32KB)
    const maxChunkSize = 16384;
    let offset = 0;

    while (offset < payload.length) {
      const currentChunk = payload.subarray(offset, offset + maxChunkSize);
      offset += maxChunkSize;

      const mac = this.computeMac(this.writeKey, currentChunk, this.writeSeq++);
      const plaintext = Buffer.concat([mac, currentChunk]);
      const encrypted = this.writeCipher.update(plaintext);
      const header = Buffer.from([0x80 | (encrypted.length >> 8), encrypted.length & 0xff]);

      const isLast = offset >= payload.length;
      this.rawSocket.write(Buffer.concat([header, encrypted]), isLast ? callback : undefined);
    }
  }

  private handleRawData(chunk: Buffer): void {
    this.inBuffer = this.inBuffer.length === 0
      ? chunk
      : Buffer.concat([this.inBuffer, chunk]);

    try {
      this.processIncomingBuffer();
    } catch (err) {
      console.error(`[Ssl2Socket] Error processing SSL 2.0 data: ${(err as Error).message}`);
      this.emit('error', err as Error);
      this.destroy(err as Error);
    }
  }

  private processIncomingBuffer(): void {
    while (this.inBuffer.length >= 2) {
      // SSL 2.0 2-byte header
      const isTwoByte = (this.inBuffer[0] & 0x80) !== 0;
      if (!isTwoByte) {
        throw new Error(`Unsupported 3-byte SSLv2 header received: 0x${this.inBuffer[0].toString(16)}`);
      }

      const recLen = ((this.inBuffer[0] & 0x7f) << 8) | this.inBuffer[1];
      if (this.inBuffer.length < 2 + recLen) {
        // Need more data from socket
        break;
      }

      const record = this.inBuffer.subarray(2, 2 + recLen);
      this.inBuffer = this.inBuffer.subarray(2 + recLen);

      if (this.state === 'WAIT_CLIENT_HELLO') {
        this.handleClientHello(record);
      } else if (this.state === 'WAIT_CLIENT_MASTER_KEY') {
        this.handleClientMasterKey(record);
      } else if (this.state === 'WAIT_CLIENT_FINISHED') {
        this.handleClientFinished(record);
      } else if (this.state === 'ESTABLISHED') {
        this.handleApplicationRecord(record);
      }
    }
  }

  /**
   * Parses SSL 2.0 CLIENT_HELLO and sends SERVER_HELLO.
   */
  private handleClientHello(record: Buffer): void {
    const msgType = record[0];
    if (msgType !== SSL2_MT.CLIENT_HELLO) {
      throw new Error(`Expected CLIENT_HELLO (1), received ${msgType}`);
    }

    const version = record.readUInt16BE(1);
    const cipherSpecLen = record.readUInt16BE(3);
    const sessionIdLen = record.readUInt16BE(5);
    const challengeLen = record.readUInt16BE(7);

    let offset = 9;
    const ciphers = record.subarray(offset, offset + cipherSpecLen);
    offset += cipherSpecLen;
    offset += sessionIdLen; // skip session ID
    this.challenge = Buffer.from(record.subarray(offset, offset + challengeLen));

    console.log(`[Ssl2Socket] SSL 2.0 CLIENT_HELLO: ver=0x${version.toString(16)}, ciphers=${ciphers.toString('hex')}, challengeLen=${challengeLen}`);

    // Generate Server Connection ID (16 random bytes)
    this.connId = crypto.randomBytes(16);

    // Selected cipher: SSL_CK_RC4_128_WITH_MD5 (0x01, 0x00, 0x80)
    const serverCiphers = Buffer.from([0x01, 0x00, 0x80]);

    // Construct SERVER_HELLO (11-byte header + cert + ciphers + connId)
    const sHelloPayload = Buffer.concat([
      Buffer.from([
        SSL2_MT.SERVER_HELLO, // 0x04
        0x00,                 // session_id_hit = 0
        0x01,                 // certificate_type = SSL_CT_X509_CERTIFICATE (1)
        0x00, 0x02,           // server_version = 0x0002 (SSL 2.0)
      ]),
      Buffer.from([this.certDer.length >> 8, this.certDer.length & 0xff]),
      Buffer.from([serverCiphers.length >> 8, serverCiphers.length & 0xff]),
      Buffer.from([this.connId.length >> 8, this.connId.length & 0xff]),
      this.certDer,
      serverCiphers,
      this.connId,
    ]);

    const sHelloRec = Buffer.concat([
      Buffer.from([0x80 | (sHelloPayload.length >> 8), sHelloPayload.length & 0xff]),
      sHelloPayload,
    ]);

    this.state = 'WAIT_CLIENT_MASTER_KEY';
    this.rawSocket.write(sHelloRec);
  }

  /**
   * Parses SSL 2.0 CLIENT_MASTER_KEY, derives session keys, and sends SERVER_VERIFY.
   */
  private handleClientMasterKey(record: Buffer): void {
    const msgType = record[0];
    if (msgType !== SSL2_MT.CLIENT_MASTER_KEY) {
      throw new Error(`Expected CLIENT_MASTER_KEY (2), received ${msgType}`);
    }

    const clearKeyLen = record.readUInt16BE(4);
    const encKeyLen = record.readUInt16BE(6);
    const keyArgLen = record.readUInt16BE(8);

    console.log(`[Ssl2Socket] CLIENT_MASTER_KEY received: clearKeyLen=${clearKeyLen}, encKeyLen=${encKeyLen}, keyArgLen=${keyArgLen}`);

    const encKey = record.subarray(10 + clearKeyLen, 10 + clearKeyLen + encKeyLen);

    // Decrypt RSA-1024 encrypted master key with server private key
    this.masterKey = crypto.privateDecrypt(
      { key: this.privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      encKey
    );

    console.log(`[Ssl2Socket] Decrypted master key: length=${this.masterKey.length}`);

    if (this.masterKey.length !== 16) {
      throw new Error(`Invalid decrypted master key length: ${this.masterKey.length} (expected 16)`);
    }

    // Derive symmetric keys according to Netscape SSL 2.0 / EA DirtySDK 2004:
    // Server write key (server to client) = MD5(masterKey + "0" + challenge + connId)
    // Server read key (client to server)  = MD5(masterKey + "1" + challenge + connId)
    this.writeKey = this.deriveKey(this.masterKey, '0', this.challenge!, this.connId!);
    this.readKey = this.deriveKey(this.masterKey, '1', this.challenge!, this.connId!);

    console.log(`[Ssl2Socket] Session keys derived`);

    this.readCipher = new Rc4Cipher(this.readKey);
    this.writeCipher = new Rc4Cipher(this.writeKey);

    // In Netscape SSL 2.0 / EA DirtySDK 2004, record sequence counting begins from connection start:
    // Server side: SERVER_HELLO is record 0 (unencrypted), SERVER_VERIFY is record 1, SERVER_FINISHED is record 2.
    // Client side: CLIENT_HELLO is record 0 (unencrypted), CLIENT_MASTER_KEY is record 1 (unencrypted), CLIENT_FINISHED is record 2.
    this.writeSeq = 1;
    this.readSeq = 2;

    // Send SERVER_VERIFY: payload = [0x05, ...challenge]
    const svPayload = Buffer.concat([Buffer.from([SSL2_MT.SERVER_VERIFY]), this.challenge!]);
    const svMac = this.computeMac(this.writeKey, svPayload, this.writeSeq++);
    const svEnc = this.writeCipher.update(Buffer.concat([svMac, svPayload]));
    const svRec = Buffer.concat([
      Buffer.from([0x80 | (svEnc.length >> 8), svEnc.length & 0xff]),
      svEnc,
    ]);

    console.log(`[Ssl2Socket] Sent SERVER_VERIFY (${svRec.length} bytes, encPayloadLen=${svEnc.length})`);
    this.state = 'WAIT_CLIENT_FINISHED';
    this.rawSocket.write(svRec);
  }

  /**
   * Decrypts and verifies CLIENT_FINISHED, then sends SERVER_FINISHED.
   */
  private handleClientFinished(record: Buffer): void {
    console.log(`[Ssl2Socket] Raw record in WAIT_CLIENT_FINISHED (${record.length} bytes)`);

    // Check if client sent an unencrypted SSL2_MT_ERROR
    if (record.length === 3 && record[0] === SSL2_MT.ERROR) {
      const errCode = record.readUInt16BE(1);
      throw new Error(`Client sent unencrypted SSL 2.0 ERROR: 0x${errCode.toString(16)}`);
    }

    const dec = this.readCipher!.update(record);
    const mac = dec.subarray(0, 16);
    const payload = dec.subarray(16);

    console.log(`[Ssl2Socket] Payload received: msgType=${payload[0]} (0x${payload[0]?.toString(16)}), length=${payload.length}`);

    const expectedMac = this.computeMac(this.readKey!, payload, this.readSeq);
    console.log(`[Ssl2Socket] Verifying CLIENT_FINISHED MAC (seq=${this.readSeq})`);

    if (!mac.equals(expectedMac)) {
      // Also check with other sequence number or alternative derivation
      console.warn(`[Ssl2Socket] MAC mismatch`);
      throw new Error('CLIENT_FINISHED MAC verification failed');
    }
    this.readSeq++;

    if (payload[0] !== SSL2_MT.CLIENT_FINISHED) {
      throw new Error(`Expected CLIENT_FINISHED (3), received ${payload[0]}`);
    }

    const clientConnId = payload.subarray(1);
    if (!clientConnId.equals(this.connId!)) {
      throw new Error('CLIENT_FINISHED connection ID mismatch');
    }

    // Send SERVER_FINISHED: payload = [0x06, ...sessionId]
    const sessionId = crypto.randomBytes(16);
    const sfPayload = Buffer.concat([Buffer.from([SSL2_MT.SERVER_FINISHED]), sessionId]);
    const sfMac = this.computeMac(this.writeKey!, sfPayload, this.writeSeq++);
    const sfEnc = this.writeCipher!.update(Buffer.concat([sfMac, sfPayload]));
    const sfRec = Buffer.concat([
      Buffer.from([0x80 | (sfEnc.length >> 8), sfEnc.length & 0xff]),
      sfEnc,
    ]);

    this.rawSocket.write(sfRec);
    this.state = 'ESTABLISHED';

    console.log(`[Ssl2Socket] SSL 2.0 handshake ESTABLISHED on port ${this.rawSocket.localPort} with ${this.remoteAddress}:${this.remotePort}`);
    this.emit('secureConnect');
    this.emit('secure');
  }

  /**
   * Decrypts an incoming application data record, verifies its MAC, and pushes plaintext to stream.
   */
  private handleApplicationRecord(record: Buffer): void {
    const dec = this.readCipher!.update(record);
    const mac = dec.subarray(0, 16);
    const payload = dec.subarray(16);

    const expectedMac = this.computeMac(this.readKey!, payload, this.readSeq++);
    if (!mac.equals(expectedMac)) {
      throw new Error('SSL 2.0 application record MAC verification failed');
    }

    // Push decrypted payload to stream consumers
    this.push(payload);
  }

  private deriveKey(masterKey: Buffer, counterChar: string, challenge: Buffer, connId: Buffer): Buffer {
    return crypto.createHash('md5')
      .update(masterKey)
      .update(Buffer.from(counterChar, 'ascii'))
      .update(challenge)
      .update(connId)
      .digest();
  }

  private computeMac(key: Buffer, payload: Buffer, seq: number): Buffer {
    const seqBuf = Buffer.alloc(4);
    seqBuf.writeUInt32BE(seq, 0);
    return crypto.createHash('md5')
      .update(key)
      .update(payload)
      .update(seqBuf)
      .digest();
  }
}
