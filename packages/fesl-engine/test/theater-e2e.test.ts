import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import { FeslEngineServer } from '../src/server.js';
import { encodePacket, decodePacket, THEATER_SUBSYSTEMS } from '@mohpa/shared';

describe('Theater Protocol TCP End-to-End Simulation', () => {
  let server: FeslEngineServer;
  const TEST_THEATER_CLIENT_PORT = 19285;
  const TEST_THEATER_SERVER_PORT = 19066;

  beforeAll(async () => {
    server = new FeslEngineServer();
    await server.start([
      { port: TEST_THEATER_CLIENT_PORT, isTls: false, name: 'Test Theater Client (TCP)' },
      { port: TEST_THEATER_SERVER_PORT, isTls: false, name: 'Test Theater Server (TCP)' },
    ]);
  });

  afterAll(async () => {
    await server.stop();
  });

  function createClient(port: number): Promise<{
    socket: net.Socket;
    send: (subsystem: string, subtype: number, payload: Record<string, any>) => void;
    waitForPacket: (predicate: (decoded: any) => boolean) => Promise<any>;
    close: () => void;
  }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        let buffer = Buffer.alloc(0);
        const listeners: Array<(decoded: any) => boolean> = [];

        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (true) {
            const decoded = decodePacket(buffer);
            if (!decoded) break;
            buffer = buffer.subarray(decoded.header.packetLength);
            for (let i = listeners.length - 1; i >= 0; i--) {
              if (listeners[i](decoded)) {
                listeners.splice(i, 1);
              }
            }
          }
        });

        const send = (subsystem: string, subtype: number, payload: Record<string, any>) => {
          const encoded = encodePacket(subsystem, subtype, payload);
          socket.write(encoded);
        };

        const waitForPacket = (predicate: (decoded: any) => boolean): Promise<any> => {
          return new Promise((res) => {
            listeners.push((decoded) => {
              if (predicate(decoded)) {
                res(decoded);
                return true;
              }
              return false;
            });
          });
        };

        const close = () => {
          socket.end();
          socket.destroy();
        };

        resolve({ socket, send, waitForPacket, close });
      });

      socket.on('error', reject);
    });
  }

  it('runs complete Dedicated Server & Client Theater session lifecycle', async () => {
    // 1. Create sessions in Redis/Memory session store
    const serverSession = await server.sessionStore.createSession({
      userId: 999,
      personaId: 9991,
      username: 'gameserver_host',
      personaName: 'DedicatedHost_01',
      clientType: 'dedicated',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
    });

    const clientSession = await server.sessionStore.createSession({
      userId: 100,
      personaId: 1001,
      username: 'player_one',
      personaName: 'SgtJohnson',
      clientType: 'client',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
    });

    // 2. Connect Dedicated Game Server
    const host = await createClient(TEST_THEATER_SERVER_PORT);

    // Host CONN
    host.send(THEATER_SUBSYSTEMS.CONN, 0x00000001, {
      TID: '1',
      LKEY: serverSession.lkey,
      PROT: 2,
    });
    const hostConnRes = await host.waitForPacket((d) => d.header.subsystem === 'CONN');
    expect(String(hostConnRes.payload.TID)).toBe('1');
    expect(hostConnRes.payload.TIME).toBeDefined();

    // Host CGAM (Create Game)
    host.send(THEATER_SUBSYSTEMS.CGAM, 0x00000002, {
      TID: '2',
      LID: 1,
      NAME: 'mohPA Official Minsk Titan',
      IP: '127.0.0.1',
      PORT: 16567,
      'MAX-PLAYERS': 64,
      mapName: 'Minsk',
      gameMode: 'Titan',
      ranked: '1',
    });
    const cgamRes = await host.waitForPacket((d) => d.header.subsystem === 'CGAM');
    expect(String(cgamRes.payload.TID)).toBe('2');
    expect(cgamRes.payload.GID).toBeDefined();
    const registeredGid = Number(cgamRes.payload.GID);

    // 3. Connect Client
    const client = await createClient(TEST_THEATER_CLIENT_PORT);

    // Client CONN
    client.send(THEATER_SUBSYSTEMS.CONN, 0x00000001, {
      TID: '1',
      LKEY: clientSession.lkey,
      PROT: 2,
    });
    const clientConnRes = await client.waitForPacket((d) => d.header.subsystem === 'CONN');
    expect(String(clientConnRes.payload.TID)).toBe('1');
    expect(Number(clientConnRes.payload.CID)).toBe(1001);

    // Client USER
    client.send(THEATER_SUBSYSTEMS.USER, 0x00000002, {
      TID: '2',
      CID: 1001,
    });
    const userRes = await client.waitForPacket((d) => d.header.subsystem === 'USER');
    expect(String(userRes.payload.TID)).toBe('2');
    expect(userRes.payload.NAME).toBe('SgtJohnson');

    // Client LLST (Lobbies)
    client.send(THEATER_SUBSYSTEMS.LLST, 0x00000003, {
      TID: '3',
    });
    const llstRes = await client.waitForPacket((d) => d.header.subsystem === 'LLST');
    expect(String(llstRes.payload.TID)).toBe('3');
    expect(Number(llstRes.payload['NUM-LOBBIES'])).toBeGreaterThanOrEqual(1);

    // Client GLST (Game List)
    client.send(THEATER_SUBSYSTEMS.GLST, 0x00000004, {
      TID: '4',
      LID: 1,
    });
    const glstRes = await client.waitForPacket((d) => d.header.subsystem === 'GLST');
    expect(String(glstRes.payload.TID)).toBe('4');
    expect(Number(glstRes.payload['NUM-GAMES'])).toBeGreaterThanOrEqual(1);

    // Client GDAT (Game Detail)
    client.send(THEATER_SUBSYSTEMS.GDAT, 0x00000005, {
      TID: '5',
      GID: registeredGid,
    });
    const gdatRes = await client.waitForPacket((d) => d.header.subsystem === 'GDAT');
    expect(String(gdatRes.payload.TID)).toBe('5');
    expect(Number(gdatRes.payload.GID)).toBe(registeredGid);
    expect(gdatRes.payload.NAME).toContain('mohPA Official Minsk Titan');

    // 4. Client EGAM (Enter Game)
    // Setup host listener for incoming EGRQ and PENT
    const egrqPromise = host.waitForPacket((d) => d.header.subsystem === 'EGRQ');
    const pentPromise = host.waitForPacket((d) => d.header.subsystem === 'PENT');

    client.send(THEATER_SUBSYSTEMS.EGAM, 0x00000006, {
      TID: '6',
      GID: registeredGid,
      PID: 1001,
      NAME: 'SgtJohnson',
      TEAM: 1,
    });

    const egamRes = await client.waitForPacket((d) => d.header.subsystem === 'EGAM');
    expect(String(egamRes.payload.TID)).toBe('6');
    expect(Number(egamRes.payload.GID)).toBe(registeredGid);
    expect(egamRes.payload.TICKET).toBeDefined();
    expect(Number(egamRes.payload.PORT)).toBe(16567);

    // Verify host received EGRQ and PENT
    const egrq = await egrqPromise;
    expect(Number(egrq.payload.GID)).toBe(registeredGid);
    expect(Number(egrq.payload.PID)).toBe(1001);
    expect(egrq.payload.NAME).toBe('SgtJohnson');

    const pent = await pentPromise;
    expect(Number(pent.payload.GID)).toBe(registeredGid);
    expect(Number(pent.payload.PID)).toBe(1001);

    // 5. Update Player Attributes (UPLA)
    client.send(THEATER_SUBSYSTEMS.UPLA, 0x00000007, {
      TID: '7',
      GID: registeredGid,
      PID: 1001,
      SCORE: 1200,
      KILLS: 10,
      DEATHS: 1,
      PING: 24,
      TEAM: 1,
      STATUS: 'active',
    });
    const uplaRes = await client.waitForPacket((d) => d.header.subsystem === 'UPLA');
    expect(String(uplaRes.payload.TID)).toBe('7');
    expect(Number(uplaRes.payload.SUCCESS)).toBe(1);

    // 6. Echo / Ping Probe
    client.send(THEATER_SUBSYSTEMS.PING, 0x00000008, {
      TID: '8',
      'CLIENT-TIME': '1700000000',
    });
    const pingRes = await client.waitForPacket((d) => d.header.subsystem === 'PING');
    expect(String(pingRes.payload.TID)).toBe('8');
    expect(pingRes.payload.TIME).toBeDefined();

    // 7. Leave Game (ECNL)
    client.send(THEATER_SUBSYSTEMS.ECNL, 0x00000009, {
      TID: '9',
      GID: registeredGid,
      PID: 1001,
      REASON: 'Round complete',
    });
    const ecnlRes = await client.waitForPacket((d) => d.header.subsystem === 'ECNL');
    expect(String(ecnlRes.payload.TID)).toBe('9');
    expect(Number(ecnlRes.payload.SUCCESS)).toBe(1);

    // Close connections
    client.close();
    host.close();
  });
});
