import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import * as dgram from 'node:dgram';
import { MemoryDbClient } from '@mohpa/db';
import { buildServer } from '../src/server.js';

describe('API Service Game Server Query Integration', () => {
  let app: FastifyInstance;
  let db: MemoryDbClient;
  let mockServerUdp: dgram.Socket;
  let mockUdpPort: number;

  let currentMap = 'Henderson Airfield';
  let currentGameMode = 'Invader';
  let currentPlayers = [
    { name: 'TommyConlin', score: 120, ping: 25 },
    { name: 'FrankMinoso', score: 85, ping: 35 },
  ];

  beforeAll(async () => {
    db = new MemoryDbClient();
    app = await buildServer({
      db,
      jwtSecret: 'test-jwt-secret-12345',
      internalApiKey: 'test-internal-key-67890',
    });
    await app.ready();

    // Start mock dedicated server UDP socket that responds to GameSpy 1 queries
    mockServerUdp = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => mockServerUdp.bind(0, '127.0.0.1', () => resolve()));
    mockUdpPort = mockServerUdp.address().port;

    mockServerUdp.on('message', (msg, rinfo) => {
      const text = msg.toString('utf-8');
      if (text.includes('status')) {
        const playerParts = currentPlayers
          .map(
            (p, idx) =>
              `\\player_${idx}\\${p.name}\\score_${idx}\\${p.score}\\ping_${idx}\\${p.ping}\\team_${idx}\\1`
          )
          .join('');

        const resp = `\\hostname\\mohPA Official Test Node\\hostport\\13200\\mapname\\${currentMap}\\gametype\\${currentGameMode}\\numplayers\\${currentPlayers.length}\\maxplayers\\32\\gamever\\1.2\\dedicated\\1${playerParts}\\final\\`;
        mockServerUdp.send(resp, rinfo.port, rinfo.address);
      }
    });
  });

  afterAll(async () => {
    if (mockServerUdp) {
      try {
        mockServerUdp.close();
      } catch {}
    }
    await app.close();
  });

  it('POST /api/v1/servers/register actively queries server and populates live data', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/servers/register',
      payload: {
        name: 'User Typed Placeholder Name',
        gameSlug: 'mohpa',
        ipAddress: '127.0.0.1',
        port: 13200,
        queryPort: mockUdpPort,
        maxPlayers: 64,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.queried).toBe(true);
    expect(body.server).toBeDefined();

    // Check that backend populated REAL queried data instead of placeholder/fake data!
    expect(body.server.name).toBe('mohPA Official Test Node');
    expect(body.server.mapName).toBe('Henderson Airfield');
    expect(body.server.gameMode).toBe('Invader');
    expect(body.server.currentPlayers).toBe(2);
    expect(body.server.maxPlayers).toBe(32);
    expect(body.server.isOnline).toBe(true);

    // Scoreboard in details
    expect(body.server.details.players).toHaveLength(2);
    expect(body.server.details.players[0].name).toBe('TommyConlin');
    expect(body.server.details.rules.gamever).toBe('1.2');
  });

  it('POST /api/v1/servers/:id/query refreshes server state on-demand', async () => {
    // First register the server
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/servers/register',
      payload: {
        name: 'Test Node 2',
        gameSlug: 'mohpa',
        ipAddress: '127.0.0.1',
        port: 13200,
        queryPort: mockUdpPort,
      },
    });
    const serverId = JSON.parse(regRes.body).server.id;

    // Simulate game server rotating map and adding a player
    currentMap = 'Guadalcanal Swamp';
    currentGameMode = 'Round-Based Match';
    currentPlayers.push({ name: 'WillyGaines', score: 40, ping: 20 });

    // Call on-demand query endpoint
    const queryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverId}/query`,
    });

    expect(queryRes.statusCode).toBe(200);
    const queryBody = JSON.parse(queryRes.body);
    expect(queryBody.success).toBe(true);
    expect(queryBody.online).toBe(true);
    expect(queryBody.server.mapName).toBe('Guadalcanal Swamp');
    expect(queryBody.server.gameMode).toBe('Round-Based Match');
    expect(queryBody.server.currentPlayers).toBe(3);
    expect(queryBody.scoreboard).toHaveLength(3);
  });

  it('POST /api/v1/servers/register marks server as offline if UDP probe times out', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/servers/register',
      payload: {
        name: 'Offline Server Node',
        gameSlug: 'mohpa',
        ipAddress: '127.0.0.1',
        port: 59997,
        queryPort: 59997,
        queryTimeoutMs: 150,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.queried).toBe(false);
    expect(body.server.isOnline).toBe(false);
    expect(body.server.currentPlayers).toBe(0);
    expect(body.server.details.queryError).toBeDefined();
  });
});
