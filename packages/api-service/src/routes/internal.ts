/**
 * CentralSpy Internal IPC Routes (/internal)
 * Secured with X-Internal-Key for direct communication with fesl-engine.
 */

import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';

export const internalRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply internal authentication to all internal endpoints
  fastify.addHook('preHandler', fastify.authenticateInternal);

  // Validate credentials for FESL Login / NuLogin
  fastify.post('/auth/validate', async (request, reply) => {
    const { identifier, username, email, password, gameSlug } = request.body as any || {};
    const loginId = (identifier || username || email || '').trim();

    if (!loginId || !password) {
      return reply.code(400).send({ valid: false, error: 'Identifier and password required' });
    }

    const user = await fastify.userRepo.findByUsernameOrEmail(loginId);
    if (!user) {
      return reply.code(401).send({ valid: false, error: 'Invalid credentials' });
    }

    if (user.isBanned) {
      return reply.code(403).send({ valid: false, error: 'Account is banned' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return reply.code(401).send({ valid: false, error: 'Invalid credentials' });
    }

    // Fetch personas for the game if specified
    const personas = gameSlug
      ? await fastify.personaRepo.findByUserIdAndGame(user.id, gameSlug)
      : await fastify.personaRepo.findByUserId(user.id);

    return reply.send({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        countryCode: user.countryCode,
        dob: user.dob,
        isAdmin: user.isAdmin
      },
      personas
    });
  });

  // Get persona list for NuGetPersonas / GetPersonas
  fastify.get('/personas/list', async (request, reply) => {
    const { userId, gameSlug } = request.query as any || {};

    if (!userId) {
      return reply.code(400).send({ error: 'userId is required' });
    }

    let personas = gameSlug
      ? await fastify.personaRepo.findByUserIdAndGame(userId, gameSlug)
      : await fastify.personaRepo.findByUserId(userId);

    // Fallback: If user has no active personas yet, provide default persona using their username
    if (personas.length === 0) {
      const user = await fastify.userRepo.findById(userId);
      if (user) {
        personas = [{
          id: user.id,
          userId: user.id,
          gameSlug: gameSlug || 'mohpa',
          name: user.username,
          isActive: !user.isBanned,
          createdAt: user.createdAt
        }];
      }
    }

    const enriched = await Promise.all(
      personas.map(async (p) => {
        const stats = await fastify.statsRepo.getStats(p.id);
        return {
          ...p,
          stats: stats || { score: 0, kills: 0, deaths: 0, wins: 0, losses: 0, timePlayedSeconds: 0 }
        };
      })
    );

    return reply.send({ personas: enriched });
  });

  // Lookup persona by name for NuLookupUserInfo
  fastify.get('/personas/lookup', async (request, reply) => {
    const { name, gameSlug } = request.query as any || {};
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }

    let persona = gameSlug
      ? await fastify.personaRepo.findByNameAndGame(name, gameSlug)
      : await fastify.personaRepo.findByName(name);

    // Fallback: If not found, check registered user
    if (!persona) {
      const user = await fastify.userRepo.findByUsername(name);
      if (user) {
        persona = {
          id: user.id,
          userId: user.id,
          gameSlug: gameSlug || 'mohpa',
          name: user.username,
          isActive: !user.isBanned,
          createdAt: user.createdAt
        };
      }
    }

    if (!persona) {
      return reply.code(404).send({ error: 'Persona not found' });
    }

    return reply.send(persona);
  });

  // Get user details by ID
  fastify.get('/users/:id', async (request, reply) => {
    const { id } = request.params as any;
    const user = await fastify.userRepo.findById(id);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return reply.send({
      id: user.id,
      username: user.username,
      email: user.email,
      countryCode: user.countryCode,
      dob: user.dob,
      isAdmin: user.isAdmin,
      isBanned: user.isBanned,
    });
  });

  // Update user demographic details by ID
  fastify.put('/users/:id', async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as any || {};
    const user = await fastify.userRepo.update(id, updates);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return reply.send(user);
  });

  // Post-match telemetry reporting (gsum / rank update)
  fastify.post('/stats/report', async (request, reply) => {
    const {
      personaId,
      score = 0,
      kills = 0,
      deaths = 0,
      wins = 0,
      losses = 0,
      timePlayedSeconds = 0,
      customStats = {},
      match
    } = request.body as any || {};

    if (!personaId) {
      return reply.code(400).send({ error: 'personaId is required' });
    }

    const updatedStats = await fastify.statsRepo.incrementStats(personaId, {
      score: Number(score),
      kills: Number(kills),
      deaths: Number(deaths),
      wins: Number(wins),
      losses: Number(losses),
      timePlayedSeconds: Number(timePlayedSeconds),
      customStats
    });

    let recordedMatch = null;
    if (match && match.gameSlug && match.mapName) {
      recordedMatch = await fastify.statsRepo.recordMatch({
        serverId: match.serverId || null,
        gameSlug: match.gameSlug,
        mapName: match.mapName,
        gameMode: match.gameMode || 'Conquest',
        durationSeconds: Number(match.durationSeconds || 0),
        winnerTeam: match.winnerTeam !== undefined ? Number(match.winnerTeam) : null,
        details: match.details || {}
      });
    }

    return reply.send({
      success: true,
      updatedStats,
      recordedMatch
    });
  });

  // Server lookup by IP & port or secret key
  fastify.get('/servers/lookup', async (request, reply) => {
    const { ip, port, secretKey } = request.query as any || {};

    let server = null;
    if (secretKey) {
      server = await fastify.serverRepo.findBySecretKey(secretKey);
    } else if (ip && port) {
      server = await fastify.serverRepo.findByIpAndPort(ip, Number(port));
    }

    if (!server) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    return reply.send({ server });
  });

  // Live packet ingestion for WebSocket inspector
  fastify.post('/events/packet', async (request, reply) => {
    const event = request.body as any;
    if (event && event.protocol && event.subsystemOrCommand) {
      fastify.inspectorHub.broadcastPacket({
        id: event.id || crypto.randomUUID(),
        timestamp: event.timestamp || Date.now(),
        protocol: event.protocol,
        direction: event.direction || 'INCOMING',
        clientIp: event.clientIp || '127.0.0.1',
        clientPort: Number(event.clientPort || 0),
        subsystemOrCommand: event.subsystemOrCommand,
        subtypeOrTxn: event.subtypeOrTxn || '',
        length: Number(event.length || 0),
        payload: event.payload || {},
        rawHex: event.rawHex
      });
    }

    return reply.send({ received: true });
  });
};
