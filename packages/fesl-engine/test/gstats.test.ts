import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import {
  GsStatsServer,
  gstatsXcode,
  gstatsValueForKey,
  buildGstatsChallenge,
  buildGstatsSesskey,
  gstatsPersistReplyFor,
  buildGstatsPersistReply,
} from '../src/gamespy/gstats-server.js';

describe('gstats XOR / challenge', () => {
  it('round-trips GameSpy3D xcode', () => {
    const plain = Buffer.from('\\challenge\\abcdefghijklmnopqr', 'ascii');
    expect(gstatsXcode(gstatsXcode(plain)).equals(plain)).toBe(true);
  });

  it('emits a >= 38 byte XOR challenge the 2004 SDK will wait for', () => {
    const challenge = '0123456789abcdef0123456789abcdef';
    const wire = buildGstatsChallenge(challenge);
    expect(wire.length).toBeGreaterThanOrEqual(38);
    const decoded = gstatsXcode(wire).toString('ascii');
    expect(gstatsValueForKey(decoded, 'challenge')).toBe(challenge);
  });

  it('encodes sesskey the way RecvSessionKey decodes it', () => {
    const wire = buildGstatsSesskey(4242);
    const decoded = gstatsXcode(wire).toString('ascii');
    expect(gstatsValueForKey(decoded, 'sesskey')).toBe('4242');
  });
});

describe('GameSpy gstats InitStats handshake', () => {
  let server: GsStatsServer | null = null;
  const port = 39920 + Math.floor(Math.random() * 1000);

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('completes the 2004 InitStatsConnection challenge/auth/sesskey exchange', async () => {
    server = new GsStatsServer();
    await server.start('127.0.0.1', port);

    const client = net.connect({ host: '127.0.0.1', port });
    const challengeWire = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('challenge timeout')), 2000);
      client.once('data', (chunk) => {
        clearTimeout(timer);
        resolve(Buffer.from(chunk));
      });
      client.once('error', reject);
    });

    expect(challengeWire.length).toBeGreaterThanOrEqual(38);
    const challenge = gstatsValueForKey(gstatsXcode(challengeWire).toString('ascii'), 'challenge');
    expect(challenge).toBeTruthy();
    expect(challenge!.length).toBeGreaterThan(0);

    const auth = Buffer.from('\\auth\\\\gamename\\mohpa\\response\\deadbeef\\port\\0\\id\\1', 'ascii');
    const authWire = Buffer.concat([gstatsXcode(auth), Buffer.from('\\final\\', 'ascii')]);
    const sesskeyWire = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sesskey timeout')), 2000);
      client.once('data', (chunk) => {
        clearTimeout(timer);
        resolve(Buffer.from(chunk));
      });
      client.write(authWire);
    });

    const sesskey = gstatsValueForKey(gstatsXcode(sesskeyWire).toString('ascii'), 'sesskey');
    expect(sesskey).toMatch(/^\d+$/);

    const getpd = Buffer.from('\\getpd\\\\pid\\1915791837\\lid\\1\\ptype\\0\\dindex\\0\\keys\\\\', 'ascii');
    const getpdWire = Buffer.concat([gstatsXcode(getpd), Buffer.from('\\final\\', 'ascii')]);
    const persistWire = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('persist timeout')), 2000);
      client.once('data', (chunk) => {
        clearTimeout(timer);
        resolve(Buffer.from(chunk));
      });
      client.write(getpdWire);
    });
    const persistPlain = persistWire.toString('latin1');
    expect(persistPlain.endsWith('\\final\\')).toBe(true);
    const persistBody = persistPlain.slice(0, persistPlain.lastIndexOf('\\final\\'));
    const persistDecoded = gstatsXcode(Buffer.from(persistBody, 'latin1')).toString('ascii');
    expect(persistDecoded).toContain('\\getpdr\\1');
    client.end();
  });

  it('builds persist getpdr for a getpd request', () => {
    const reply = gstatsPersistReplyFor('\\getpd\\\\pid\\5\\lid\\2\\');
    expect(reply).toContain('\\getpdr\\1\\lid\\2\\pid\\5');
    const wire = buildGstatsPersistReply(reply!);
    expect(wire.toString('latin1').endsWith('\\final\\')).toBe(true);
  });
});
