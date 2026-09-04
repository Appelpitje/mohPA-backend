import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { MemoryDbClient } from '@centralspy/db';
import { buildServer } from '../src/server.js';

describe('CentralSpy API Service Integration Tests', () => {
  let app: FastifyInstance;
  let db: MemoryDbClient;
  let authToken: string;
  let adminToken: string;
  let userId: string;
  let adminId: string;
  let personaId: string;
  let serverSecret: string;
  let serverId: string;

  beforeAll(async () => {
    db = new MemoryDbClient();
    app = await buildServer({
      db,
      jwtSecret: 'test-jwt-secret-12345',
      internalApiKey: 'test-internal-key-67890'
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health & Root', () => {
    it('GET /health returns OK', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('OK');
    });

    it('GET / returns API metadata', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('CentralSpy API Service');
    });
  });

  describe('Auth Routes (/api/v1/auth)', () => {
    it('POST /api/v1/auth/register creates user and returns JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: 'TestCommander',
          email: 'commander@centralspy.net',
          password: 'SecretPassword123',
          countryCode: 'US',
          dob: '1990-01-01'
        }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe('TestCommander');
      authToken = body.token;
      userId = body.user.id;
    });

    it('POST /api/v1/auth/login authenticates user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: 'commander@centralspy.net',
          password: 'SecretPassword123'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
    });

    it('GET /api/v1/auth/me returns profile and entitlements', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${authToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.username).toBe('TestCommander');
    });

    it('PUT /api/v1/auth/me updates demographic details', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { countryCode: 'DE' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.countryCode).toBe('DE');
    });
  });

  describe('Personas Routes (/api/v1/personas)', () => {
    it('POST /api/v1/personas creates a persona for game', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/personas',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          gameSlug: 'mohpa',
          name: 'Col_Voss'
        }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.persona.name).toBe('Col_Voss');
      expect(body.persona.gameSlug).toBe('mohpa');
      personaId = body.persona.id;
    });

    it('GET /api/v1/personas lists user personas with stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/personas',
        headers: { authorization: `Bearer ${authToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.personas.length).toBeGreaterThan(0);
      expect(body.personas[0].name).toBe('Col_Voss');
    });

    it('GET /api/v1/personas/:id/stats gets persona stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/personas/${personaId}/stats`
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.persona.id).toBe(personaId);
      expect(body.stats).toBeDefined();
    });
  });

  describe('Entitlements Routes (/api/v1/entitlements)', () => {
    it('POST /api/v1/entitlements/grant grants game license', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements/grant',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { gameSlug: 'mohpa' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.entitlement.gameSlug).toBe('mohpa');
    });

    it('GET /api/v1/entitlements lists user entitlements', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/entitlements',
        headers: { authorization: `Bearer ${authToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.entitlements.length).toBeGreaterThan(0);
    });
  });

  describe('Servers Routes (/api/v1/servers)', () => {
    it('POST /api/v1/servers/register creates server and secretKey', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/register',
        payload: {
          name: 'Pacific Theater Official Server',
          gameSlug: 'mohpa',
          ipAddress: '10.0.0.1',
          port: 13200,
          maxPlayers: 64
        }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.server.id).toBeDefined();
      expect(body.secretKey).toBeDefined();
      serverSecret = body.secretKey;
      serverId = body.server.id;
    });

    it('POST /api/v1/servers/heartbeat updates server status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/heartbeat',
        headers: { 'x-server-secret': serverSecret },
        payload: {
          currentPlayers: 48,
          mapName: 'Henderson Airfield',
          gameMode: 'Invader'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('GET /api/v1/servers lists online servers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/servers?game_slug=mohpa'
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.servers.length).toBeGreaterThan(0);
      expect(body.servers[0].mapName).toBe('Henderson Airfield');
    });

    it('GET /api/v1/servers/:id returns server detail', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/servers/${serverId}`
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.server.name).toBe('Pacific Theater Official Server');
    });
  });

  describe('Stats Routes (/api/v1/stats)', () => {
    it('GET /api/v1/stats/leaderboard/:game_slug returns leaderboard', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/leaderboard/mohpa?sort=score'
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.gameSlug).toBe('mohpa');
      expect(Array.isArray(body.leaderboard)).toBe(true);
    });

    it('GET /api/v1/stats/players/:name resolves player stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/players/Col_Voss?game_slug=mohpa'
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.persona.name).toBe('Col_Voss');
    });
  });

  describe('Internal IPC Routes (/internal)', () => {
    it('POST /internal/auth/validate validates user credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/auth/validate',
        headers: { 'x-internal-key': 'test-internal-key-67890' },
        payload: {
          identifier: 'TestCommander',
          password: 'SecretPassword123',
          gameSlug: 'mohpa'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.valid).toBe(true);
      expect(body.user.username).toBe('TestCommander');
      expect(body.personas.length).toBeGreaterThan(0);
    });

    it('GET /internal/personas/list returns user personas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/internal/personas/list?userId=${userId}&gameSlug=mohpa`,
        headers: { 'x-internal-key': 'test-internal-key-67890' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.personas).toHaveLength(1);
    });

    it('POST /internal/stats/report ingests match telemetry', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/stats/report',
        headers: { 'x-internal-key': 'test-internal-key-67890' },
        payload: {
          personaId,
          score: 2500,
          kills: 18,
          deaths: 4,
          wins: 1,
          timePlayedSeconds: 900,
          match: {
            serverId,
            gameSlug: 'mohpa',
            mapName: 'Henderson Airfield',
            gameMode: 'Invader',
            durationSeconds: 900,
            winnerTeam: 1
          }
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.updatedStats.score).toBe(2500);
      expect(body.recordedMatch.mapName).toBe('Henderson Airfield');
    });

    it('GET /internal/servers/lookup finds server by secretKey or IP/Port', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/internal/servers/lookup?secretKey=${serverSecret}`,
        headers: { 'x-internal-key': 'test-internal-key-67890' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.server.id).toBe(serverId);
    });

    it('POST /internal/events/packet ingests live inspector packet event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/events/packet',
        headers: { 'x-internal-key': 'test-internal-key-67890' },
        payload: {
          protocol: 'FESL',
          direction: 'INCOMING',
          clientIp: '127.0.0.1',
          clientPort: 54321,
          subsystemOrCommand: 'fsys',
          subtypeOrTxn: 'Hello',
          length: 45,
          payload: { TXN: 'Hello', clientType: 'client' }
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.received).toBe(true);
    });
  });

  describe('Admin Routes (/api/v1/admin)', () => {
    beforeAll(async () => {
      // Create admin user
      const adminUser = await db.query(
        `INSERT INTO users (username, email, password_hash, is_admin)
         VALUES ('RootAdmin', 'admin@centralspy.net', 'hash', TRUE)
         RETURNING *`
      );
      adminId = adminUser.rows[0].id;

      adminToken = app.jwt.sign({
        id: adminId,
        username: 'RootAdmin',
        email: 'admin@centralspy.net',
        isAdmin: true
      });
    });

    it('GET /api/v1/admin/sessions returns active sessions & inspector stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/sessions',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.inspector).toBeDefined();
    });

    it('POST /api/v1/admin/bans bans a user and logs audit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/bans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          userId,
          reason: 'Cheating violation'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('DELETE /api/v1/admin/bans/:id unbans user', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/bans/${userId}`,
        headers: { authorization: `Bearer ${adminToken}` }
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
          reason: 'AFK timeout'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('GET /api/v1/admin/audit-logs returns recorded actions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.logs.length).toBeGreaterThan(0);
    });
  });
});
