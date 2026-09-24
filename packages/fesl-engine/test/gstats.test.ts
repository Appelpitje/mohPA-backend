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

function doSend(plain: string): Buffer {
  return Buffer.concat([gstatsXcode(Buffer.from(plain, 'latin1')), Buffer.from('\\final\\', 'ascii')]);
}

function xorAlign(buf: Buffer, align: number): Buffer {
  const key = Buffer.from('GameSpy3D', 'ascii');
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i++) out[i] ^= key[(i + align) % key.length];
  return out;
}

function onceData(socket: net.Socket, timeoutMs = 2000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    socket.once('data', (chunk) => {
      clearTimeout(timer);
      resolve(Buffer.from(chunk));
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('gstats snapshot and career read', () => {
  let server: GsStatsServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('answers auth at XOR alignment 2 and ignores an unrecognized buffer', async () => {
    const reports: unknown[] = [];
    server = new GsStatsServer({
      reportMatch: async (body) => {
        reports.push(body);
        return true;
      },
      getPersonaByName: async () => null,
    });
    const port = 41000 + Math.floor(Math.random() * 1000);
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    await onceData(client);

    const plain = Buffer.from('\\auth\\\\gamename\\mohpa\\port\\29920\\id\\1', 'ascii');
    const aligned = xorAlign(plain, 2);
    const sesskeyWire = onceData(client);
    client.write(aligned);
    const sesskey = gstatsValueForKey(gstatsXcode(await sesskeyWire).toString('ascii'), 'sesskey');
    expect(sesskey).toMatch(/^\d+$/);

    client.write(Buffer.alloc(243));
    await expect(onceData(client, 300)).rejects.toThrow('timeout');
    expect(reports).toHaveLength(0);
    client.end();
  });

  it('posts one final snapshot and restores a backslash in gamedata', async () => {
    const reports: any[] = [];
    server = new GsStatsServer({
      reportMatch: async (body) => {
        reports.push(body);
        return true;
      },
      getPersonaByName: async (name) => (name === 'Col_Voss' ? { id: 'persona-1', name } : null),
    });
    const port = 42000 + Math.floor(Math.random() * 1000);
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    await onceData(client);
    const sesskeyWire = onceData(client);
    client.write(doSend('\\auth\\\\gamename\\mohpa\\port\\0\\id\\1'));
    await sesskeyWire;

    client.write(doSend('\\newgame\\\\connid\\7\\sesskey\\9'));
    client.write(doSend('\\updgame\\\\connid\\7\\sesskey\\9\\done\\0\\gamedata\\numKills_0\\1'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(reports).toHaveLength(0);

    const snapshot = '\\player_0\\Col_Voss\\numKills_0\\3\\playTime_0\\60\\gametype\\Invader';
    const gamedata = snapshot.replace(/\\/g, '\x01');
    client.write(doSend(`\\updgame\\\\connid\\7\\sesskey\\9\\done\\1\\gamedata\\${gamedata}`));
    const start = Date.now();
    while (reports.length === 0 && Date.now() - start < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(reports).toHaveLength(1);
    expect(reports[0].statsMatchKey).toBe('mohpa:7:9');
    expect(reports[0].players[0].personaId).toBe('persona-1');
    expect(reports[0].players[0].kills).toBe(3);
    expect(reports[0].players[0].timePlayedSeconds).toBe(60);
    expect(reports[0].players[0].customStats.totalNumKills).toBe(3);
    expect(reports[0].players[0].customStats.totalPlayTime_Invader).toBe(60);
    expect(reports[0].match.details.players[0].name).toBe('Col_Voss');
    expect(reports[0].match.details.gamedata.numKills_0).toBe('3');
    client.end();
  });

  it('returns career keys for a seeded persona', async () => {
    server = new GsStatsServer({
      reportMatch: async () => true,
      getPersonaByName: async () => null,
      getPersonaByGsProfileId: async (id) => {
        if (id !== 42) return null;
        return {
          id: 'p1',
          name: 'Col_Voss',
          stats: {
            kills: 4,
            deaths: 0,
            score: 0,
            timePlayedSeconds: 55,
            customStats: { totalPlayTime_Invader: 10 },
          },
        };
      },
    });
    const port = 43000 + Math.floor(Math.random() * 1000);
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    await onceData(client);
    const keys = 'totalNumKills\\totalPlayTime_Invader\\totalPlayTime_Ranked';
    const replyWire = onceData(client);
    client.write(doSend(`\\getpd\\\\pid\\42\\lid\\1\\ptype\\0\\dindex\\0\\keys\\${keys}\\`));
    const wire = (await replyWire).toString('latin1');
    expect(wire.endsWith('\\final\\')).toBe(true);
    const body = gstatsXcode(Buffer.from(wire.slice(0, wire.lastIndexOf('\\final\\')), 'latin1')).toString('latin1');
    expect(body).toContain('\\totalNumKills\\4\\totalPlayTime_Invader\\10\\totalPlayTime_Ranked\\55');
    client.end();
  });
});
