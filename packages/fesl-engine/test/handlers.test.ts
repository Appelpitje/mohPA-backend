import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import { RedisSessionStore } from '../src/session/redis-session-store.js';
import { ApiClient } from '../src/api-client/api-client.js';
import { FeslRouter } from '../src/fesl/router.js';
import { FeslConnection } from '../src/network/connection.js';
import { FeslPacket, FESL_SUBSYSTEMS, FESL_TXN } from '@centralspy/shared';

describe('FESL Subsystem Handlers & Router', () => {
  let sessionStore: RedisSessionStore;
  let apiClient: ApiClient;
  let router: FeslRouter;
  let mockSocket: net.Socket;
  let connection: FeslConnection;
  let sentPackets: any[];

  beforeEach(() => {
    sessionStore = new RedisSessionStore('redis://127.0.0.1:19999');
    apiClient = new ApiClient();
    router = new FeslRouter(sessionStore, apiClient);

    sentPackets = [];
    mockSocket = new net.Socket();
    mockSocket.write = (chunk: any) => {
      sentPackets.push(chunk);
      return true;
    };

    connection = new FeslConnection({
      id: 'test_conn_1',
      socket: mockSocket,
      serverPort: 18270,
      isTls: true,
    });
  });

  afterEach(async () => {
    await sessionStore.close();
  });

  it('handles fsys.Hello', async () => {
    const packet: FeslPacket = {
      subsystem: FESL_SUBSYSTEMS.FSYS,
      subtype: 0x00000001,
      packetLength: 50,
      payload: {
        TXN: FESL_TXN.HELLO,
        clientType: 'client',
        sku: '1234',
        locale: 'en_US',
        'domainPartition.name': 'eagames',
      },
    };

    let handledResponse: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledResponse = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledResponse).toBeDefined();
    expect(handledResponse.TXN).toBe('Hello');
    expect(handledResponse['domainPartition.name']).toBe('eagames');
    expect(handledResponse.theaterPort).toBeDefined();
    expect(handledResponse.curTime).toBeDefined();
  });

  it('handles fsys.Ping', async () => {
    const packet: FeslPacket = {
      subsystem: FESL_SUBSYSTEMS.FSYS,
      subtype: 0x00000002,
      packetLength: 30,
      payload: {
        TXN: FESL_TXN.PING,
        TID: '12345678',
      },
    };

    let handledResponse: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledResponse = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledResponse).toBeDefined();
    expect(handledResponse.TXN).toBe('Ping');
    expect(handledResponse.TID).toBe('12345678');
  });

  it('handles acct.NuLogin and creates master session', async () => {
    const packet: FeslPacket = {
      subsystem: FESL_SUBSYSTEMS.ACCT,
      subtype: 0x00000001,
      packetLength: 60,
      payload: {
        TXN: FESL_TXN.NU_LOGIN,
        nuid: 'admin',
        password: 'password123',
      },
    };

    let handledResponse: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledResponse = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledResponse).toBeDefined();
    expect(handledResponse.TXN).toBe('NuLogin');
    expect(handledResponse.lkey).toBeDefined();
    expect(handledResponse.userId).toBeDefined();

    // Connection should now have an attached session
    expect(connection.session).toBeDefined();
    expect(connection.session?.lkey).toBe(handledResponse.lkey);
  });

  it('handles acct.NuGetPersonas and acct.NuLoginPersona', async () => {
    // 1. NuLogin first
    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.ACCT,
      subtype: 0x00000001,
      packetLength: 60,
      payload: {
        TXN: FESL_TXN.NU_LOGIN,
        nuid: 'admin',
        password: 'password',
      },
    });

    // 2. NuGetPersonas
    let personasRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      personasRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.ACCT,
      subtype: 0x00000002,
      packetLength: 40,
      payload: {
        TXN: FESL_TXN.NU_GET_PERSONAS,
      },
    });

    expect(personasRes).toBeDefined();
    expect(personasRes.TXN).toBe('NuGetPersonas');
    expect(Array.isArray(personasRes.personas)).toBe(true);
    expect(personasRes.personas.length).toBeGreaterThan(0);

    const chosenPersona = personasRes.personas[0];

    // 3. NuLoginPersona
    let personaLoginRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      personaLoginRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.ACCT,
      subtype: 0x00000003,
      packetLength: 50,
      payload: {
        TXN: FESL_TXN.NU_LOGIN_PERSONA,
        name: chosenPersona,
      },
    });

    expect(personaLoginRes).toBeDefined();
    expect(personaLoginRes.TXN).toBe('NuLoginPersona');
    expect(personaLoginRes.lkey).toBeDefined();
    expect(personaLoginRes.name).toBe(chosenPersona);
    expect(personaLoginRes.personaId).toBeDefined();
  });

  it('handles subs.GetEntitlementByBundle and dobj.GetObjectInventory', async () => {
    let subsRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      subsRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.SUBS,
      subtype: 0x00000001,
      packetLength: 40,
      payload: {
        TXN: FESL_TXN.GET_ENTITLEMENT_BY_BUNDLE,
        bundleId: 10,
      },
    });

    expect(subsRes).toBeDefined();
    expect(subsRes.TXN).toBe('GetEntitlementByBundle');
    expect(subsRes.entitlements).toBeDefined();

    let dobjRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      dobjRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.DOBJ,
      subtype: 0x00000002,
      packetLength: 40,
      payload: {
        TXN: FESL_TXN.GET_OBJECT_INVENTORY,
      },
    });

    expect(dobjRes).toBeDefined();
    expect(dobjRes.TXN).toBe('GetObjectInventory');
  });

  it('handles rank.GetStats and gsum.GetSessionID', async () => {
    let rankRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      rankRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.RANK,
      subtype: 0x00000001,
      packetLength: 40,
      payload: {
        TXN: FESL_TXN.GET_STATS,
      },
    });

    expect(rankRes).toBeDefined();
    expect(rankRes.TXN).toBe('GetStats');
    expect(rankRes.stats).toBeDefined();

    let gsumRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      gsumRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.GSUM,
      subtype: 0x00000002,
      packetLength: 40,
      payload: {
        TXN: FESL_TXN.GET_SESSION_ID,
      },
    });

    expect(gsumRes).toBeDefined();
    expect(gsumRes.TXN).toBe('GetSessionID');
    expect(gsumRes.sessionId).toBeDefined();
  });

  it('handles pnow.Start and pnow.Status', async () => {
    let pnowRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      pnowRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: FESL_SUBSYSTEMS.PNOW,
      subtype: 0x00000001,
      packetLength: 40,
      payload: {
        TXN: FESL_TXN.START,
      },
    });

    expect(pnowRes).toBeDefined();
    expect(pnowRes.TXN).toBe('Start');
    expect(pnowRes.status).toBe('MATCH_FOUND');
  });
});
