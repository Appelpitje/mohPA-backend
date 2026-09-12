import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { GoaCrypt, mixListChallenge } from '../src/gamespy/goa-crypt.js';
import { GameServerRegistry } from '../src/gamespy/server-registry.js';
import {
  GsServerBrowser,
  wrapServerListReply,
  unwrapServerListReply,
  parseSbListRequest,
  MOHPA_DEFAULT_QUERY_PORT,
} from '../src/gamespy/server-browser.js';
import { MOHPA_SECKEY } from '../src/gamespy/enctype2.js';

describe('GOA crypt', () => {
  it('roundtrips a payload', () => {
    const key = Buffer.from('S6v8LmAB');
    const plain = Buffer.from('hello-gamespy-payload');
    const a = Buffer.from(plain);
    const enc = new GoaCrypt();
    enc.init(key);
    enc.encrypt(a);
    expect(a.equals(plain)).toBe(false);
    const dec = new GoaCrypt();
    dec.init(key);
    dec.decrypt(a);
    expect(a.equals(plain)).toBe(true);
  });
});

describe('GameSpy SB v2 list', () => {
  it('wraps a compact server the client can unwrap', () => {
    const challenge = Buffer.from('AbcDef12');
    const packet = wrapServerListReply(
      challenge,
      '84.199.32.114',
      MOHPA_DEFAULT_QUERY_PORT,
      [{ ip: '178.105.150.25', port: 13300 }],
      MOHPA_SECKEY,
      Buffer.from('SrvKey01'),
      Buffer.concat([Buffer.from([0, 0]), Buffer.from('rndkey')])
    );
    expect(packet[0]).toBe(8 ^ 0xec);
    const parsed = unwrapServerListReply(packet, challenge, MOHPA_SECKEY);
    expect(parsed).toBeTruthy();
    expect(parsed!.clientIp).toBe('84.199.32.114');
    expect(parsed!.defaultPort).toBe(13300);
    expect(parsed!.servers).toEqual([{ ip: '178.105.150.25', port: 13300 }]);
  });

  it('parses a list request framed like sb_serverlist.c', () => {
    const challenge = Buffer.from('12345678');
    const body: number[] = [];
    const push = (b: Buffer | number[]) => body.push(...b);
    push([0, 0]); // length placeholder
    push([0]); // SERVER_LIST_REQUEST
    push([1]); // protocol
    push([3]); // encoding
    push([0x02, 0x00, 0x00, 0x00]); // gamever LE 2
    push([...Buffer.from('mohpa\0')]);
    push([...Buffer.from('mohpa\0')]);
    push([...challenge]);
    push([0]); // empty filter
    push([...Buffer.from('\\hostname\\mapname\0')]);
    push([0, 0, 0, 0]); // options BE
    const packet = Buffer.from(body);
    packet.writeUInt16BE(packet.length, 0);
    const req = parseSbListRequest(packet);
    expect(req?.queryGame).toBe('mohpa');
    expect(req?.fromGame).toBe('mohpa');
    expect(req?.challenge.equals(challenge)).toBe(true);
    expect(req?.fields).toBe('\\hostname\\mapname');
  });
});

describe('GsServerBrowser TCP', () => {
  let server: GsServerBrowser | null = null;
  const port = 38910 + Math.floor(Math.random() * 500);

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('returns the registered dedicated server', async () => {
    const registry = new GameServerRegistry({ publicIp: '178.105.150.25' });
    registry.upsert({ ip: '178.105.150.25', port: 13300, gamename: 'mohpa' });
    server = new GsServerBrowser(registry);
    await server.start('127.0.0.1', port);

    const challenge = Buffer.from('ChalTest');
    const reqParts: number[] = [0, 0, 0, 1, 3, 2, 0, 0, 0];
    reqParts.push(...Buffer.from('mohpa\0mohpa\0'));
    reqParts.push(...challenge);
    reqParts.push(0);
    reqParts.push(...Buffer.from('\\hostname\0'));
    reqParts.push(0, 0, 0, 0);
    const request = Buffer.from(reqParts);
    request.writeUInt16BE(request.length, 0);

    const reply = await new Promise<Buffer>((resolve, reject) => {
      const client = net.connect({ host: '127.0.0.1', port });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => reject(new Error('sb timeout')), 2000);
      client.on('data', (chunk) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf.length > 20) {
          clearTimeout(timer);
          client.end();
          resolve(buf);
        }
      });
      client.on('error', reject);
      client.write(request);
    });

    const parsed = unwrapServerListReply(reply, challenge, MOHPA_SECKEY);
    expect(parsed?.servers).toEqual([{ ip: '178.105.150.25', port: 13300 }]);
  });
});

describe('mixListChallenge', () => {
  it('is stable for a known input', () => {
    const a = mixListChallenge(Buffer.from('AbcDef12'), Buffer.from('SrvKey01'), MOHPA_SECKEY);
    const b = mixListChallenge(Buffer.from('AbcDef12'), Buffer.from('SrvKey01'), MOHPA_SECKEY);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(Buffer.from('AbcDef12'))).toBe(false);
  });
});
