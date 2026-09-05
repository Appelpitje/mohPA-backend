import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { FeslEngineServer } from '../src/server.js';
import { Rc4Cipher } from '../src/network/ssl2-socket.js';
import { encodePacket, decodePacket } from '@centralspy/shared';

describe('SSL 2.0 MOHPA Client End-to-End Test', () => {
  let server: FeslEngineServer;
  const MOHPA_TEST_PORT = 18020;

  beforeAll(async () => {
    server = new FeslEngineServer();
    await server.start([
      { port: MOHPA_TEST_PORT, isTls: true, name: 'FESL Client MOHPA (TLS 18020)' },
    ]);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('completes SSL 2.0 handshake with 2004 DirtySDK ClientHello and exchanges FESL packets', async () => {
    const client = net.connect({
      host: '127.0.0.1',
      port: MOHPA_TEST_PORT,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    // 1. Send MOHPA's exact DirtySDK SSL 2.0 ClientHello (captured from real mohpa.exe)
    const rawClientHello = Buffer.from('801c010002000300000010010080303132333435363738393a3b3c3d3e3f', 'hex');
    client.write(rawClientHello);

    const challenge = Buffer.from('0123456789:;<=>?');
    let connId: Buffer;
    const masterKey = crypto.randomBytes(16);

    let readKey: Buffer;
    let writeKey: Buffer;
    let readCipher: Rc4Cipher;
    let writeCipher: Rc4Cipher;
    let readSeq = 1; // client expects SERVER_VERIFY as record 1
    let writeSeq = 2; // client sends CLIENT_FINISHED as record 2

    let state = 'WAIT_SERVER_HELLO';
    let buffer = Buffer.alloc(0);

    const deriveKey = (mKey: Buffer, counterChar: string, ch: Buffer, cId: Buffer) => {
      return crypto.createHash('md5')
        .update(mKey)
        .update(Buffer.from(counterChar, 'ascii'))
        .update(ch)
        .update(cId)
        .digest();
    };

    const computeMac = (key: Buffer, payload: Buffer, seq: number) => {
      const seqBuf = Buffer.alloc(4);
      seqBuf.writeUInt32BE(seq, 0);
      return crypto.createHash('md5')
        .update(key)
        .update(payload)
        .update(seqBuf)
        .digest();
    };

    const handshakeDone = new Promise<Buffer>((resolve, reject) => {
      client.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        try {
          if (state === 'WAIT_SERVER_HELLO') {
            if (buffer.length < 2) return;
            const recLen = ((buffer[0] & 0x7f) << 8) | buffer[1];
            if (buffer.length < 2 + recLen) return;

            const sHello = buffer.subarray(2, 2 + recLen);
            buffer = buffer.subarray(2 + recLen);

            expect(sHello[0]).toBe(0x04); // SERVER_HELLO
            expect(sHello.readUInt16BE(3)).toBe(0x0002); // version 2

            const certLen = sHello.readUInt16BE(5);
            const cipherLen = sHello.readUInt16BE(7);
            const connIdLen = sHello.readUInt16BE(9);

            const certDer = sHello.subarray(11, 11 + certLen);
            connId = Buffer.from(sHello.subarray(11 + certLen + cipherLen, 11 + certLen + cipherLen + connIdLen));

            // Extract RSA public key from DER certificate to encrypt master key
            const certObj = new crypto.X509Certificate(certDer);
            const publicKey = certObj.publicKey;

            // Encrypt master key with server public key
            const encKey = crypto.publicEncrypt(
              { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
              masterKey
            );

            // Send CLIENT_MASTER_KEY
            const cmkPayload = Buffer.concat([
              Buffer.from([0x02, 0x01, 0x00, 0x80]), // type=2, cipher=010080
              Buffer.from([0x00, 0x00]),             // clear key len = 0
              Buffer.from([encKey.length >> 8, encKey.length & 0xff]),
              Buffer.from([0x00, 0x00]),             // key arg len = 0
              encKey,
            ]);

            const cmkRec = Buffer.concat([
              Buffer.from([0x80 | (cmkPayload.length >> 8), cmkPayload.length & 0xff]),
              cmkPayload,
            ]);

            writeKey = deriveKey(masterKey, '1', challenge, connId); // client write is '1' (server read)
            readKey = deriveKey(masterKey, '0', challenge, connId);  // client read is '0' (server write)
            writeCipher = new Rc4Cipher(writeKey);
            readCipher = new Rc4Cipher(readKey);

            state = 'WAIT_SERVER_VERIFY';
            client.write(cmkRec);
          }

          if (state === 'WAIT_SERVER_VERIFY') {
            if (buffer.length < 2) return;
            const recLen = ((buffer[0] & 0x7f) << 8) | buffer[1];
            if (buffer.length < 2 + recLen) return;

            const svEnc = buffer.subarray(2, 2 + recLen);
            buffer = buffer.subarray(2 + recLen);

            const svDec = readCipher.update(svEnc);
            const svMac = svDec.subarray(0, 16);
            const svPayload = svDec.subarray(16);

            const expMac = computeMac(readKey, svPayload, readSeq++);
            expect(svMac).toEqual(expMac);
            expect(svPayload[0]).toBe(0x05); // SERVER_VERIFY
            expect(svPayload.subarray(1)).toEqual(challenge);

            // Send CLIENT_FINISHED
            const cfPayload = Buffer.concat([Buffer.from([0x03]), connId]);
            const cfMac = computeMac(writeKey, cfPayload, writeSeq++);
            const cfEnc = writeCipher.update(Buffer.concat([cfMac, cfPayload]));
            const cfRec = Buffer.concat([
              Buffer.from([0x80 | (cfEnc.length >> 8), cfEnc.length & 0xff]),
              cfEnc,
            ]);

            state = 'WAIT_SERVER_FINISHED';
            client.write(cfRec);
          }

          if (state === 'WAIT_SERVER_FINISHED') {
            if (buffer.length < 2) return;
            const recLen = ((buffer[0] & 0x7f) << 8) | buffer[1];
            if (buffer.length < 2 + recLen) return;

            const sfEnc = buffer.subarray(2, 2 + recLen);
            buffer = buffer.subarray(2 + recLen);

            const sfDec = readCipher.update(sfEnc);
            const sfMac = sfDec.subarray(0, 16);
            const sfPayload = sfDec.subarray(16);

            const expMac = computeMac(readKey, sfPayload, readSeq++);
            expect(sfMac).toEqual(expMac);
            expect(sfPayload[0]).toBe(0x06); // SERVER_FINISHED

            state = 'ESTABLISHED';

            // Handshake is established! Send an encrypted FESL packet (fsys Hello)
            const feslHello = encodePacket('fsys', 0x01, {
              TXN: 'Hello',
              clientString: 'MOHPA-PC',
              clientPlatform: 'PC',
              locale: 'en_US',
            });

            const helloMac = computeMac(writeKey, feslHello, writeSeq++);
            const helloEnc = writeCipher.update(Buffer.concat([helloMac, feslHello]));
            const helloRec = Buffer.concat([
              Buffer.from([0x80 | (helloEnc.length >> 8), helloEnc.length & 0xff]),
              helloEnc,
            ]);

            client.write(helloRec);
          }

          if (state === 'ESTABLISHED') {
            if (buffer.length < 2) return;
            const recLen = ((buffer[0] & 0x7f) << 8) | buffer[1];
            if (buffer.length < 2 + recLen) return;

            const encData = buffer.subarray(2, 2 + recLen);
            buffer = buffer.subarray(2 + recLen);

            const decData = readCipher.update(encData);
            const mac = decData.subarray(0, 16);
            const appPayload = decData.subarray(16);

            const expMac = computeMac(readKey, appPayload, readSeq++);
            expect(mac).toEqual(expMac);

            resolve(appPayload);
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    const responseBytes = await handshakeDone;
    const decoded = decodePacket(responseBytes);

    expect(decoded).toBeDefined();
    expect(decoded?.header.subsystem).toBe('fsys');
    expect(decoded?.header.subtype).toBe(0x80000001); // response to Hello
    expect(decoded?.payload.TXN).toBe('Hello');

    client.destroy();
  });
});
