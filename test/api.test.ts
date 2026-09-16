import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { MemoryDbClient } from '@mohpa/db';
import { buildServer } from '@mohpa/api-service';

describe('mohPA API Service Full REST & IPC Test Suite', () => {
  let app: FastifyInstance;
  let db: MemoryDbClient;
  let authToken: string;
  let adminToken: string;
  let userId: string;
  let adminId: string;
  let personaId: string;
  let serverSecret: string;
  let serverId: string;

  const JWT_SECRET = 'test-jwt-secret-key-1234567890';
  const INTERNAL_KEY = 'test-internal-ipc-key-abcdef';

  beforeAll(async () => {
    db = new MemoryDbClient();
    app = await buildServer({
      db,
      jwtSecret: JWT_SECRET,
      internalApiKey: INTERNAL_KEY,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health & Service Metadata Endpoints', () => {
    it('GET /health returns 200 OK', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('OK');
      expect(body.dbConnected).toBe(true);
    });

    it('GET / returns API service information', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('mohPA API Service');
      expect(body.version).toBeDefined();
    });
  });

  describe('Authentication Routes (/api/v1/auth)', () => {
    it('POST /api/v1/auth/register fails with missing fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username: 'Incomplete' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/v1/auth/register successfully creates a new user and returns JWT token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: 'TestCommander',
          email: 'commander@mohpa.net',
          password: 'SecretPassword123',
          countryCode: 'US',
          dob: '1990-05-15',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(body.user).toBeDefined();
      expect(body.user.username).toBe('TestCommander');
      expect(body.user.email).toBe('commander@mohpa.net');
      expect(body.user.countryCode).toBe('US');
      expect(body.user.passwordHash).toBeUndefined(); // Sensitive data omitted

      authToken = body.token;
      userId = body.user.id;
    });

    it('POST /api/v1/auth/register rejects duplicate username', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: 'TestCommander',
          email: 'another@mohpa.net',
          password: 'SecretPassword123',
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('POST /api/v1/auth/register rejects duplicate email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: 'AnotherCommander',
          email: 'commander@mohpa.net',
          password: 'SecretPassword123',
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('POST /api/v1/auth/login authenticates via email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'commander@mohpa.net',
          password: 'SecretPassword123',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe('TestCommander');
    });

    it('POST /api/v1/auth/login authenticates via username', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'TestCommander',
          password: 'SecretPassword123',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe('commander@mohpa.net');
    });

    it('POST /api/v1/auth/login rejects wrong password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'TestCommander',
          password: 'WrongPassword!',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/v1/auth/login rejects non-existent user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'NonExistentUser',
          password: 'SomePassword123',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/auth/me returns user profile and entitlements with valid Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.id).toBe(userId);
      expect(body.user.username).toBe('TestCommander');
      expect(Array.isArray(body.entitlements)).toBe(true);
    });

    it('GET /api/v1/auth/me rejects unauthorized request without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('PUT /api/v1/auth/me updates demographic details', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { countryCode: 'DE' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.countryCode).toBe('DE');
    });
  });

  describe('Personas Routes (/api/v1/personas)', () => {
    it('POST /api/v1/personas creates a soldier persona for MOHPA', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/personas',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          gameSlug: 'mohpa',
          name: 'Col_Voss',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.persona).toBeDefined();
      expect(body.persona.name).toBe('Col_Voss');
      expect(body.persona.gameSlug).toBe('mohpa');
      expect(body.persona.userId).toBe(userId);
      personaId = body.persona.id;
    });

    it('POST /api/v1/personas rejects duplicate persona name in same game', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/personas',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          gameSlug: 'mohpa',
          name: 'Col_Voss',
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('POST /api/v1/personas rejects invalid name characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/personas',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          gameSlug: 'mohpa',
          name: 'Invalid*Name#@',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET /api/v1/personas lists personas with stats summary', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/personas?game_slug=mohpa',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.personas.length).toBeGreaterThanOrEqual(1);
      expect(body.personas[0].name).toBe('Col_Voss');
      expect(body.personas[0].stats).toBeDefined();
    });

    it('GET /api/v1/personas/:id/stats returns detailed persona stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/personas/${personaId}/stats`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.persona.id).toBe(personaId);
      expect(body.stats).toBeDefined();
      expect(body.stats.score).toBeDefined();
    });
  });

  describe('Entitlements & CD Keys Routes (/api/v1/entitlements)', () => {
    it('POST /api/v1/entitlements/grant grants game license to current user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements/grant',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { gameSlug: 'mohpa' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.entitlement.gameSlug).toBe('mohpa');
    });

    it('GET /api/v1/entitlements lists user entitlements', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/entitlements',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.entitlements.length).toBeGreaterThan(0);
      expect(body.entitlements.some((e: any) => e.gameSlug === 'mohpa')).toBe(true);
    });

    it('POST /api/v1/entitlements/claim claims a CD key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements/claim',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          cdKey: 'BF21-TEST-KEY1-ABCD',
          gameSlug: 'mohpa',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.entitlement).toBeDefined();
    });
  });

  describe('Game Servers Routes (/api/v1/servers)', () => {
    it('POST /api/v1/servers/register creates game server and returns secret key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/register',
        payload: {
          name: 'EU Official 2142 Titan',
          gameSlug: 'mohpa',
          ipAddress: '10.0.0.1',
          port: 17567,
          queryPort: 18567,
          maxPlayers: 64,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.server.id).toBeDefined();
      expect(body.server.name).toBe('EU Official 2142 Titan');
      expect(body.secretKey).toBeDefined();

      serverSecret = body.secretKey;
      serverId = body.server.id;
    });

    it('POST /api/v1/servers/heartbeat updates server status and map info', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/heartbeat',
        headers: { 'x-server-secret': serverSecret },
        payload: {
          currentPlayers: 48,
          maxPlayers: 64,
          mapName: 'Minsk',
          gameMode: 'Titan',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('GET /api/v1/servers lists online servers filtered by game', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/servers?game_slug=mohpa',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.servers.length).toBeGreaterThan(0);
      expect(body.servers[0].name).toBe('EU Official 2142 Titan');
      expect(body.servers[0].mapName).toBe('Minsk');
      expect(body.servers[0].secretKey).toBeUndefined();
    });

    it('GET /api/v1/servers/:id returns server detail', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/servers/${serverId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.server.id).toBe(serverId);
      expect(body.server.name).toBe('EU Official 2142 Titan');
      expect(body.server.secretKey).toBeUndefined();
    });
  });

  describe('Stats & Leaderboard Routes (/api/v1/stats)', () => {
    it('GET /api/v1/stats/leaderboard/:game_slug returns leaderboard rankings', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/leaderboard/mohpa?sort=score&limit=10',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.gameSlug).toBe('mohpa');
      expect(Array.isArray(body.leaderboard)).toBe(true);
    });

    it('GET /api/v1/stats/players/:name resolves player stats profile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/players/Col_Voss?game_slug=mohpa',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.persona.name).toBe('Col_Voss');
      expect(body.stats).toBeDefined();
    });
  });

  describe('Internal IPC Routes (/internal)', () => {
    it('POST /internal/auth/validate validates credentials and returns user & personas', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/auth/validate',
        headers: { 'x-internal-key': INTERNAL_KEY },
        payload: {
          identifier: 'TestCommander',
          password: 'SecretPassword123',
          gameSlug: 'mohpa',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.valid).toBe(true);
      expect(body.user.username).toBe('TestCommander');
      expect(body.personas.length).toBeGreaterThan(0);
      expect(body.personas[0].name).toBe('Col_Voss');
    });

    it('POST /internal/auth/validate rejects invalid internal API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/auth/validate',
        headers: { 'x-internal-key': 'invalid-key' },
        payload: {
          identifier: 'TestCommander',
          password: 'SecretPassword123',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('GET /internal/personas/list returns user personas list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/internal/personas/list?userId=${userId}&gameSlug=mohpa`,
        headers: { 'x-internal-key': INTERNAL_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.personas).toHaveLength(1);
      expect(body.personas[0].name).toBe('Col_Voss');
    });

    it('GET /internal/personas/lookup finds persona by soldier name', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/internal/personas/lookup?name=Col_Voss&gameSlug=mohpa',
        headers: { 'x-internal-key': INTERNAL_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('Col_Voss');
      expect(body.gameSlug).toBe('mohpa');
    });

    it('POST /internal/stats/report ingests match telemetry & updates scoreboard', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/stats/report',
        headers: { 'x-internal-key': INTERNAL_KEY },
        payload: {
          personaId,
          score: 3500,
          kills: 25,
          deaths: 5,
          wins: 1,
          timePlayedSeconds: 1200,
          match: {
            serverId,
            gameSlug: 'mohpa',
            mapName: 'Minsk',
            gameMode: 'Titan',
            durationSeconds: 1200,
            winnerTeam: 1,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.updatedStats.score).toBe(3500);
      expect(body.recordedMatch.mapName).toBe('Minsk');
    });

    it('GET /internal/servers/lookup finds registered server by secretKey', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/internal/servers/lookup?secretKey=${serverSecret}`,
        headers: { 'x-internal-key': INTERNAL_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.server.id).toBe(serverId);
    });

    it('POST /internal/events/packet ingests live inspector packet event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/events/packet',
        headers: { 'x-internal-key': INTERNAL_KEY },
        payload: {
          protocol: 'FESL',
          direction: 'INCOMING',
          clientIp: '127.0.0.1',
          clientPort: 54321,
          subsystemOrCommand: 'fsys',
          subtypeOrTxn: 'Hello',
          length: 45,
          payload: { TXN: 'Hello', clientType: 'client' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.received).toBe(true);
    });

    it('GET & PUT /internal/users/:id manages user demographics', async () => {
      const getRes = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}`,
        headers: { 'x-internal-key': INTERNAL_KEY },
      });
      expect(getRes.statusCode).toBe(200);
      const user = JSON.parse(getRes.body);
      expect(user.username).toBe('TestCommander');

      const putRes = await app.inject({
        method: 'PUT',
        url: `/internal/users/${userId}`,
        headers: { 'x-internal-key': INTERNAL_KEY },
        payload: { countryCode: 'FR' },
      });
      expect(putRes.statusCode).toBe(200);
    });
  });

  describe('Admin & Moderation Routes (/api/v1/admin)', () => {
    beforeAll(async () => {
      // Create admin user in database
      const adminUser = await db.query(
        `INSERT INTO users (username, email, password_hash, is_admin)
         VALUES ('RootAdmin', 'admin@mohpa.net', 'hash', TRUE)
         RETURNING *`
      );
      adminId = adminUser.rows[0].id;

      adminToken = app.jwt.sign({
        id: adminId,
        username: 'RootAdmin',
        email: 'admin@mohpa.net',
        isAdmin: true,
      });
    });

    it('GET /api/v1/admin/sessions returns active sessions & inspector stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/sessions',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.inspector).toBeDefined();
    });

    it('POST /api/v1/admin/server-keys creates dedicated server key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/server-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serverName: 'Official Titan Ranked #1',
          gameSlug: 'mohpa',
          ipAddress: '127.0.0.1',
          port: 16567,
          isRanked: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.secretKey).toBeDefined();
      expect(body.server.name).toBe('Official Titan Ranked #1');
    });

    it('POST /api/v1/admin/bans bans a user and records audit log', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/bans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          userId,
          reason: 'Rules violation',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('DELETE /api/v1/admin/bans/:id unbans user and logs audit', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/bans/${userId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('POST /api/v1/admin/kick dispatches kick command', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/kick',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          userId,
          reason: 'AFK timeout',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('GET /api/v1/admin/audit-logs returns recorded actions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.logs.length).toBeGreaterThan(0);
    });
  });
});
