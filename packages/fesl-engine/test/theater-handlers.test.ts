import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import { RedisSessionStore } from '../src/session/redis-session-store.js';
import { ApiClient } from '../src/api-client/api-client.js';
import { LobbyManager } from '../src/theater/lobby-manager.js';
import { TheaterRouter } from '../src/theater/router.js';
import { FeslConnection } from '../src/network/connection.js';
import { FeslPacket, THEATER_SUBSYSTEMS } from '@mohpa/shared';

describe('Theater Subsystem Handlers & Router', () => {
  let sessionStore: RedisSessionStore;
  let apiClient: ApiClient;
  let lobbyManager: LobbyManager;
  let router: TheaterRouter;
  let mockSocket: net.Socket;
  let connection: FeslConnection;
  let sentPackets: any[];

  beforeEach(() => {
    sessionStore = new RedisSessionStore('redis://127.0.0.1:19999');
    apiClient = new ApiClient();
    lobbyManager = new LobbyManager(apiClient);
    router = new TheaterRouter(sessionStore, apiClient, lobbyManager);

    sentPackets = [];
    mockSocket = new net.Socket();
    mockSocket.write = (chunk: any) => {
      sentPackets.push(chunk);
      return true;
    };

    connection = new FeslConnection({
      id: 'theater_test_conn_1',
      socket: mockSocket,
      serverPort: 18275,
      isTls: false,
    });
  });

  afterEach(async () => {
    await sessionStore.close();
    lobbyManager.clear();
  });

  it('handles CONN with valid LKEY and authenticates session', async () => {
    // 1. Create session in store
    const session = await sessionStore.createSession({
      userId: 10,
      personaId: 1001,
      username: 'recon_sniper',
      personaName: 'ReconMaster',
      clientType: 'client',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
    });

    const packet: FeslPacket = {
      subsystem: THEATER_SUBSYSTEMS.CONN,
      subtype: 0x00000001,
      packetLength: 40,
      payload: {
        TID: '1',
        LKEY: session.lkey,
        PROT: 2,
      },
    };

    let handledRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledRes = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledRes).toBeDefined();
    expect(handledRes.TID).toBe('1');
    expect(handledRes.TIME).toBeDefined();
    expect(handledRes.CID).toBe(1001);
    expect(connection.session?.lkey).toBe(session.lkey);
  });

  it('rejects CONN with invalid LKEY', async () => {
    const packet: FeslPacket = {
      subsystem: THEATER_SUBSYSTEMS.CONN,
      subtype: 0x00000001,
      packetLength: 40,
      payload: {
        TID: '1',
        LKEY: 'invalid_nonexistent_token',
      },
    };

    let handledRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledRes = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledRes).toBeDefined();
    expect(handledRes.errorContainer).toBeDefined();
    expect(handledRes.errorContainer[0].fieldName).toBe('LKEY');
  });

  it('handles USER and returns persona and permissions', async () => {
    connection.attachSession({
      lkey: 'valid_tok',
      userId: 5,
      personaId: 505,
      username: 'pilot',
      personaName: 'GunshipPro',
      clientType: 'client',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    });

    const packet: FeslPacket = {
      subsystem: THEATER_SUBSYSTEMS.USER,
      subtype: 0x00000002,
      packetLength: 30,
      payload: {
        TID: '2',
        CID: 505,
      },
    };

    let handledRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledRes = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledRes).toBeDefined();
    expect(handledRes.TID).toBe('2');
    expect(handledRes.NAME).toBe('GunshipPro');
    expect(handledRes.PID).toBe(505);
    expect(handledRes.PERM).toBe(0);
  });

  it('handles LLST and returns lobby listing', async () => {
    const packet: FeslPacket = {
      subsystem: THEATER_SUBSYSTEMS.LLST,
      subtype: 0x00000003,
      packetLength: 30,
      payload: {
        TID: '3',
      },
    };

    let handledRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      handledRes = res;
    });

    await router.handlePacket(connection, packet);

    expect(handledRes).toBeDefined();
    expect(handledRes.TID).toBe('3');
    expect(handledRes['NUM-LOBBIES']).toBeGreaterThanOrEqual(1);
    expect(handledRes.LID).toBe(1);
    expect(handledRes.NAME).toBeDefined();
  });

  it('handles CGAM, GLST, and GDAT lifecycle', async () => {
    // 1. CGAM - Dedicated server registers
    let cgamRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      cgamRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.CGAM,
      subtype: 0x00000001,
      packetLength: 80,
      payload: {
        TID: '1',
        NAME: 'Official EA Titan 64',
        IP: '127.0.0.1',
        PORT: 16567,
        'MAX-PLAYERS': 64,
        mapName: 'Suez Canal',
        gameMode: 'Titan',
        ranked: '1',
      },
    });

    expect(cgamRes).toBeDefined();
    expect(cgamRes.TID).toBe('1');
    expect(cgamRes.GID).toBeDefined();
    const gid = cgamRes.GID;

    // 2. GLST - Client searches for servers
    let glstRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      glstRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.GLST,
      subtype: 0x00000002,
      packetLength: 40,
      payload: {
        TID: '2',
        LID: 1,
      },
    });

    expect(glstRes).toBeDefined();
    expect(glstRes.TID).toBe('2');
    expect(glstRes['NUM-GAMES']).toBe(1);
    expect(glstRes.GID).toBe(gid);

    // 3. GDAT - Client requests server detail
    let gdatRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      gdatRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.GDAT,
      subtype: 0x00000003,
      packetLength: 30,
      payload: {
        TID: '3',
        GID: gid,
      },
    });

    expect(gdatRes).toBeDefined();
    expect(gdatRes.TID).toBe('3');
    expect(gdatRes.GID).toBe(gid);
    expect(gdatRes.NAME).toContain('Official EA Titan 64');
  });

  it('handles EGAM (Enter Game) and returns ticket', async () => {
    const game = await lobbyManager.createGame({
      name: 'EGAM Test Server',
      port: 16567,
    });

    connection.attachSession({
      lkey: 'test_token',
      userId: 77,
      personaId: 7701,
      username: 'AssaultGuy',
      personaName: 'AssaultGuy',
      clientType: 'client',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    });

    let egamRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      egamRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.EGAM,
      subtype: 0x00000001,
      packetLength: 40,
      payload: {
        TID: '10',
        GID: game.gid,
        PID: 7701,
        NAME: 'AssaultGuy',
      },
    });

    expect(egamRes).toBeDefined();
    expect(egamRes.TID).toBe('10');
    expect(egamRes.GID).toBe(game.gid);
    expect(egamRes.TICKET).toBeDefined();
    expect(egamRes.SLOT).toBe(0);
    expect(egamRes.PID).toBe(7701);
  });

  it('handles UPLA (Update Player Attributes)', async () => {
    const game = await lobbyManager.createGame({
      name: 'UPLA Test Server',
      port: 16567,
    });
    await lobbyManager.enterGame(game.gid, connection, { pid: 888 });

    let uplaRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      uplaRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.UPLA,
      subtype: 0x00000001,
      packetLength: 50,
      payload: {
        TID: '20',
        GID: game.gid,
        PID: 888,
        SCORE: 2500,
        KILLS: 15,
        DEATHS: 2,
        PING: 32,
        TEAM: 1,
      },
    });

    expect(uplaRes).toBeDefined();
    expect(uplaRes.TID).toBe('20');
    expect(uplaRes.SUCCESS).toBe(1);

    const player = game.players.get(888);
    expect(player?.score).toBe(2500);
    expect(player?.kills).toBe(15);
  });

  it('handles PING and ECHO latency probes', async () => {
    let pingRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      pingRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.PING,
      subtype: 0x00000001,
      packetLength: 30,
      payload: {
        TID: '30',
        'CLIENT-TIME': '1700000000',
      },
    });

    expect(pingRes).toBeDefined();
    expect(pingRes.TID).toBe('30');
    expect(pingRes.TIME).toBeDefined();
    expect(pingRes['CLIENT-TIME']).toBe('1700000000');

    let echoRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      echoRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.ECHO,
      subtype: 0x00000002,
      packetLength: 30,
      payload: {
        TID: '31',
        'CLIENT-TIME': '1700000001',
      },
    });

    expect(echoRes).toBeDefined();
    expect(echoRes.TID).toBe('31');
    expect(echoRes.TIME).toBeDefined();
  });

  it('handles KICK and ECNL game leaving', async () => {
    const game = await lobbyManager.createGame({
      name: 'Leave Test Server',
      port: 16567,
    });
    await lobbyManager.enterGame(game.gid, connection, { pid: 999 });

    let ecnlRes: any = null;
    router.once('handled', (_conn, _req, res) => {
      ecnlRes = res;
    });

    await router.handlePacket(connection, {
      subsystem: THEATER_SUBSYSTEMS.ECNL,
      subtype: 0x00000001,
      packetLength: 30,
      payload: {
        TID: '40',
        GID: game.gid,
        PID: 999,
        REASON: 'Quit match',
      },
    });

    expect(ecnlRes).toBeDefined();
    expect(ecnlRes.TID).toBe('40');
    expect(ecnlRes.SUCCESS).toBe(1);
    expect(game.currentPlayers).toBe(0);
  });
});
