import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { MemoryDbClient } from '@mohpa/db';
import { buildServer } from '../src/server.js';

describe('Server History API (/api/v1/servers/:id/history)', () => {
  let app: FastifyInstance;
  let db: MemoryDbClient;
  let testServerId: string;

  beforeAll(async () => {
    db = new MemoryDbClient();
    app = await buildServer({
      db,
      jwtSecret: 'test-jwt-secret-12345',
      internalApiKey: 'test-internal-key-67890',
    });
    await app.ready();

    // Register a test game server
    const server = await app.serverRepo.register({
      name: 'Henderson Airfield Combat',
      gameSlug: 'mohpa',
      ipAddress: '127.0.0.1',
      port: 12203,
      isRanked: true,
      maxPlayers: 32,
      currentPlayers: 12,
      mapName: 'Henderson Airfield',
      gameMode: 'Invader',
    });
    testServerId = server.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/servers/:id/history returns 200 with 24h chart and summary', async () => {
    // Record sample snapshots and player sessions
    await app.serverHistoryRepo.recordSnapshot(testServerId, {
      playerCount: 16,
      maxPlayers: 32,
      isOnline: true,
      mapName: 'Henderson Airfield',
    });
    await app.serverHistoryRepo.recordPlayerSessions(
      testServerId,
      [
        { name: 'Sgt_Miller', score: 1500, kills: 12, deaths: 4 },
        { name: 'Capt_Speirs', score: 2100, kills: 18, deaths: 2 },
      ],
      600
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/servers/${testServerId}/history?range=24h`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.server.id).toBe(testServerId);
    expect(body.range).toBe('24h');
    expect(body.chart).toBeInstanceOf(Array);
    expect(body.chart.length).toBeGreaterThan(0);
    expect(body.summary).toBeDefined();
    expect(body.summary.currentPlayers).toBe(12);
    expect(body.summary.peakPlayers).toBeGreaterThanOrEqual(16);
    expect(body.players).toBeInstanceOf(Array);
    expect(body.players.length).toBeGreaterThanOrEqual(2);
    expect(body.players[0].name).toBe('Capt_Speirs');
    expect(body.players[0].score).toBe(2100);
    expect(body.players[0].timePlayedSeconds).toBe(600);
  });

  it('GET /api/v1/servers/:id/history?range=7d and ?range=30d support different timeframes', async () => {
    const res7d = await app.inject({
      method: 'GET',
      url: `/api/v1/servers/${testServerId}/history?range=7d`,
    });
    expect(res7d.statusCode).toBe(200);
    const body7d = JSON.parse(res7d.payload);
    expect(body7d.range).toBe('7d');
    expect(body7d.chart.length).toBeGreaterThan(0);

    const res30d = await app.inject({
      method: 'GET',
      url: `/api/v1/servers/${testServerId}/history?range=30d`,
    });
    expect(res30d.statusCode).toBe(200);
    const body30d = JSON.parse(res30d.payload);
    expect(body30d.range).toBe('30d');
    expect(body30d.chart.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/servers/:id/history with ?seed=true seeds sample data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/servers/${testServerId}/history?range=30d&seed=true`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.chart.length).toBeGreaterThan(50);
    expect(body.players.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/servers/:id/history returns 404 for unknown server', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/servers/00000000-0000-0000-0000-000000000000/history',
    });
    expect(res.statusCode).toBe(404);
  });
});
