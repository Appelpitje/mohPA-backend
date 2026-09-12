import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { GsMasterServer } from '../src/gamespy/master-server.js';
import { unwrapEnctype2, MOHPA_SECKEY } from '../src/gamespy/enctype2.js';
import { GameServerRegistry } from '../src/gamespy/server-registry.js';
import { decodeCompactList } from '../src/gamespy/compact-list.js';

function collect(socket: net.Socket, ms: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => resolve(Buffer.concat(chunks)), ms);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('GameSpy GOA master', () => {
  let server: GsMasterServer | null = null;
  const port = 38900 + Math.floor(Math.random() * 1000);

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('greets with secure and does not auto-send \\final\\', async () => {
    server = new GsMasterServer();
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    const buf = await collect(client, 120);
    const text = buf.toString('ascii');
    expect(text).toContain('\\secure\\');
    expect(text.includes('\\final\\')).toBe(false);
    client.end();
  });

  it('finishes a plain list request with \\final\\', async () => {
    server = new GsMasterServer();
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    const all = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`master timeout got ${JSON.stringify(buf)}`)), 2000);
      client.on('data', (chunk) => {
        buf += chunk.toString('ascii');
        if (buf.includes('\\secure\\') && buf.includes('\\final\\')) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      client.write('\\list\\cmp\\gamename\\mohpa\\final\\');
    });
    expect(all).toContain('\\secure\\');
    expect(all.endsWith('\\final\\') || all.includes('\\final\\')).toBe(true);
    client.end();
  });

  it('replies to enctype2 with a wrapped empty list the client can unwrap', async () => {
    server = new GsMasterServer();
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    const all = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => reject(new Error('enctype2 timeout')), 2000);
      client.on('data', (chunk) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        // Greeting is 21 bytes; wait for the enctype2 header+body after it.
        if (buf.length > 21 + 8) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      client.write(
        '\\gamename\\mohpa\\gamever\\2\\location\\0\\validate\\xxxxxx\\enctype\\2\\final\\\\queryid\\1.1\\'
      );
      client.write('\\list\\cmp\\gamename\\mohpa\\final\\');
    });
    const greet = Buffer.from('\\basic\\\\secure\\ABCDEF', 'ascii');
    expect(all.subarray(0, greet.length).equals(greet)).toBe(true);
    const payload = all.subarray(greet.length);
    expect(payload[0]).not.toBe(0x5c);
    expect(unwrapEnctype2(payload, MOHPA_SECKEY)?.toString('ascii')).toBe('\\final\\');
    client.end();
  });

  it('returns compact IP:port for a registered dedicated server', async () => {
    const registry = new GameServerRegistry({ publicIp: '178.105.150.25' });
    registry.upsert({ ip: '178.105.150.25', port: 13300, gamename: 'mohpa' });
    server = new GsMasterServer(registry);
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    const all = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => reject(new Error('enctype2 timeout')), 2000);
      client.on('data', (chunk) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf.length > 21 + 8) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      client.write(
        '\\gamename\\mohpa\\gamever\\2\\location\\0\\validate\\xxxxxx\\enctype\\2\\final\\\\queryid\\1.1\\'
      );
      client.write('\\list\\cmp\\gamename\\mohpa\\final\\');
    });
    const greet = Buffer.from('\\basic\\\\secure\\ABCDEF', 'ascii');
    const payload = all.subarray(greet.length);
    const body = unwrapEnctype2(payload, MOHPA_SECKEY);
    expect(body).toBeTruthy();
    expect(decodeCompactList(body!)).toEqual([{ ip: '178.105.150.25', port: 13300 }]);
    client.end();
  });
});
