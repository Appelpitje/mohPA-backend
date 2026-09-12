import { describe, it, expect, afterEach } from 'vitest';
import * as dgram from 'node:dgram';
import { GsAvailableServer, GS_AVAILABLE_OK, buildAvailableReply } from '../src/gamespy/available-server.js';
import { GameServerRegistry } from '../src/gamespy/server-registry.js';
import { decodeCompactList } from '../src/gamespy/compact-list.js';

describe('GameSpy UDP availability', () => {
  let server: GsAvailableServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('builds a 7-byte available reply starting with fe fd 09', () => {
    const request = Buffer.from([0x09, 0x00, 0x00, 0x00, 0x00, ...Buffer.from('mohpa\0')]);
    const reply = buildAvailableReply(request);
    expect(reply.equals(GS_AVAILABLE_OK)).toBe(true);
    expect(reply.length).toBeGreaterThanOrEqual(7);
    expect(reply.subarray(3, 7).equals(Buffer.from([0, 0, 0, 0]))).toBe(true);
  });

  it('answers a 0x09 probe with available status', async () => {
    const port = 37900 + Math.floor(Math.random() * 1000);
    server = new GsAvailableServer();
    await server.start('127.0.0.1', port);

    const reply = await new Promise<Buffer>((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        client.close();
        reject(new Error('timeout'));
      }, 2000);
      client.on('message', (msg) => {
        clearTimeout(timer);
        client.close();
        resolve(msg);
      });
      client.on('error', (err) => {
        clearTimeout(timer);
        client.close();
        reject(err);
      });
      const request = Buffer.concat([Buffer.from([0x09, 0x00, 0x00, 0x00, 0x00]), Buffer.from('mohpa\0')]);
      client.send(request, port, '127.0.0.1');
    });

    expect(reply.subarray(0, 3).equals(Buffer.from([0xfe, 0xfd, 0x09]))).toBe(true);
    expect(reply.subarray(3, 7).equals(Buffer.from([0, 0, 0, 0]))).toBe(true);
  });

  it('registers a QR1 heartbeat and returns it on UDP \\list\\, rewriting loopback', async () => {
    const port = 37900 + Math.floor(Math.random() * 1000);
    const registry = new GameServerRegistry({ publicIp: '178.105.150.25' });
    server = new GsAvailableServer(registry);
    await server.start('127.0.0.1', port);

    const list = await new Promise<Buffer>((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        client.close();
        reject(new Error('timeout'));
      }, 2000);
      let sawHeartbeatAck = false;
      client.on('message', (msg) => {
        if (msg[0] === 0xfe && msg[1] === 0xfd && msg[2] === 0x09) {
          client.close();
          clearTimeout(timer);
          reject(new Error('heartbeat got availability reply'));
          return;
        }
        if (!sawHeartbeatAck) {
          sawHeartbeatAck = true;
          client.send(Buffer.from('\\list\\\\gamename\\mohpa\\final\\', 'ascii'), port, '127.0.0.1');
          return;
        }
        clearTimeout(timer);
        client.close();
        resolve(msg);
      });
      client.send(Buffer.from('\\heartbeat\\13300\\gamename\\mohpa', 'ascii'), port, '127.0.0.1');
    });

    expect(decodeCompactList(list)).toEqual([{ ip: '178.105.150.25', port: 13300 }]);
  });
});
