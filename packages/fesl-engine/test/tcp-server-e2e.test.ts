import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { FeslEngineServer } from '../src/server.js';
import { encodePacket, decodePacket, FESL_SUBSYSTEMS, FESL_TXN } from '@mohpa/shared';

describe('TCP / TLS Server End-to-End Test', () => {
  let server: FeslEngineServer;
  const TEST_FESL_CLIENT_PORT = 19270;
  const TEST_FESL_SERVER_PORT = 19051;
  const TEST_THEATER_CLIENT_PORT = 19275;

  beforeAll(async () => {
    server = new FeslEngineServer();
    server.apiClient.validateCredentials = async (id: string, pw?: string) => ({
      valid: true,
      user: {
        userId: 4935,
        username: id,
        email: `${id}@mohpa.local`,
        country: 'US',
        language: 'en',
        dobDay: 1,
        dobMonth: 1,
        dobYear: 1990,
        zipCode: '10001',
        isAdmin: false,
        isBanned: false,
      },
    });
    server.apiClient.getPersonas = async (userId: string | number) => [
      { personaId: 493501, userId, name: `Player_${userId}`, gameSlug: 'mohpa', isActive: true },
    ];
    await server.start([
      { port: TEST_FESL_CLIENT_PORT, isTls: true, name: 'Test FESL Client (TLS)' },
      { port: TEST_FESL_SERVER_PORT, isTls: true, name: 'Test FESL Server (TLS)' },
      { port: TEST_THEATER_CLIENT_PORT, isTls: false, name: 'Test Theater Client (TCP)' },
    ]);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('connects via TLS and performs full handshake and login flow', async () => {
    const client = tls.connect({
      host: '127.0.0.1',
      port: TEST_FESL_CLIENT_PORT,
      rejectUnauthorized: false,
    });

    await new Promise<void>((resolve, reject) => {
      client.on('secureConnect', resolve);
      client.on('error', reject);
    });

    const receivedChunks: Buffer[] = [];
    let buffer = Buffer.alloc(0);

    const waitForPacket = (predicate: (decoded: any) => boolean): Promise<any> => {
      return new Promise((resolve) => {
        const check = () => {
          const decoded = decodePacket(buffer);
          if (decoded && predicate(decoded)) {
            buffer = buffer.subarray(decoded.header.packetLength);
            resolve(decoded);
            return;
          }
        };

        const onData = (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          check();
        };

        client.on('data', onData);
        check();
      });
    };

    // 1. Send fsys.Hello
    const helloReq = encodePacket(FESL_SUBSYSTEMS.FSYS, 0x00000001, {
      TXN: FESL_TXN.HELLO,
      clientType: 'client',
      sku: '1234',
    });
    client.write(helloReq);

    const helloRes = await waitForPacket((d) => d.payload.TXN === 'Hello');
    expect(helloRes.header.subsystem).toBe('fsys');
    expect(helloRes.payload.TXN).toBe('Hello');
    expect(helloRes.payload.theaterHost).toBeDefined();

    // 2. Send acct.NuLogin
    const loginReq = encodePacket(FESL_SUBSYSTEMS.ACCT, 0x00000002, {
      TXN: FESL_TXN.NU_LOGIN,
      nuid: 'pilot1',
      password: 'password',
    });
    client.write(loginReq);

    const loginRes = await waitForPacket((d) => d.payload.TXN === 'NuLogin');
    expect(loginRes.header.subsystem).toBe('acct');
    expect(loginRes.payload.TXN).toBe('NuLogin');
    expect(loginRes.payload.lkey).toBeDefined();

    const masterLkey = loginRes.payload.lkey;

    // 3. Send acct.NuGetPersonas
    const personasReq = encodePacket(FESL_SUBSYSTEMS.ACCT, 0x00000003, {
      TXN: FESL_TXN.NU_GET_PERSONAS,
      lkey: masterLkey,
    });
    client.write(personasReq);

    const personasRes = await waitForPacket((d) => d.payload.TXN === 'NuGetPersonas');
    expect(personasRes.header.subsystem).toBe('acct');
    expect(personasRes.payload.personas).toBeDefined();
    expect(personasRes.payload.personas.length).toBeGreaterThan(0);

    client.end();
    client.destroy();
  });

  it('correctly reassembles fragmented packets across multiple TCP chunks', async () => {
    const client = net.connect({
      host: '127.0.0.1',
      port: TEST_THEATER_CLIENT_PORT,
    });

    await new Promise<void>((resolve, reject) => {
      client.on('connect', resolve);
      client.on('error', reject);
    });

    let buffer = Buffer.alloc(0);
    const packetPromise = new Promise<any>((resolve) => {
      client.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const decoded = decodePacket(buffer);
        if (decoded) {
          resolve(decoded);
        }
      });
    });

    // Construct a packet and split it into 3 small fragments
    const fullPacket = encodePacket(FESL_SUBSYSTEMS.FSYS, 0x00000001, {
      TXN: FESL_TXN.PING,
      TID: 'fragmented_test_999',
    });

    const part1 = fullPacket.subarray(0, 4);
    const part2 = fullPacket.subarray(4, 14);
    const part3 = fullPacket.subarray(14);

    client.write(part1);
    await new Promise((r) => setTimeout(r, 20));
    client.write(part2);
    await new Promise((r) => setTimeout(r, 20));
    client.write(part3);

    const res = await packetPromise;
    expect(res.header.subsystem).toBe('fsys');
    expect(res.payload.TXN).toBe('Ping');
    expect(res.payload.TID).toBe('fragmented_test_999');

    client.end();
    client.destroy();
  });
});
