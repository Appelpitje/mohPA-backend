import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { GsPspServer } from '../src/gamespy/gpsp-server.js';

describe('GameSpy GPSP search', () => {
  let server: GsPspServer | null = null;
  const port = 39901 + Math.floor(Math.random() * 500);

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('greets with lc1 then finishes a search with bsrdone', async () => {
    server = new GsPspServer();
    await server.start('127.0.0.1', port);
    const client = net.connect({ host: '127.0.0.1', port });
    const all = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`gpsp timeout ${JSON.stringify(buf)}`)), 2000);
      client.on('data', (chunk) => {
        buf += chunk.toString('ascii');
        if (buf.includes('\\lc\\1') && buf.includes('\\bsrdone\\')) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      client.write('\\search\\\\uniquenick\\Appelpitje\\namespaceid\\5\\gamename\\mohpa\\final\\');
    });
    expect(all).toContain('\\lc\\1');
    expect(all).toContain('\\bsrdone\\');
    client.end();
  });
});
