/**
 * CentralSpy Game Servers REST Routes (/api/v1/servers)
 */

import { FastifyPluginAsync } from 'fastify';
import { getGameConfig } from '@centralspy/shared';

export const serverRoutes: FastifyPluginAsync = async (fastify) => {
  // Public server browser list
  fastify.get('/', async (request, reply) => {
    const query = request.query as any || {};

    const filter = {
      gameSlug: query.game_slug || query.gameSlug,
      isOnline: query.is_online !== undefined ? query.is_online === 'true' || query.is_online === true : true,
      isRanked: query.is_ranked !== undefined ? query.is_ranked === 'true' || query.is_ranked === true : undefined,
      mapName: query.map_name || query.mapName,
      search: query.search || query.q,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0
    };

    const servers = await fastify.serverRepo.listServers(filter);
    return reply.send({
      servers,
      count: servers.length,
      limit: filter.limit,
      offset: filter.offset
    });
  });

  // Get server details with live scoreboard & metadata
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const server = await fastify.serverRepo.findById(id);
    if (!server) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    return reply.send({
      server,
      scoreboard: server.details?.players || [],
      rules: server.details?.rules || {}
    });
  });

  // Register dedicated server
  fastify.post('/register', async (request, reply) => {
    const { name, gameSlug, ipAddress, port, queryPort, isRanked, maxPlayers } = request.body as any || {};

    if (!name || !gameSlug || !ipAddress || !port) {
      return reply.code(400).send({ error: 'name, gameSlug, ipAddress, and port are required' });
    }

    const config = getGameConfig(gameSlug);
    if (!config) {
      return reply.code(400).send({ error: `Unknown game slug: ${gameSlug}` });
    }

    const server = await fastify.serverRepo.register({
      name: String(name).trim(),
      gameSlug: config.slug,
      ipAddress: String(ipAddress).trim(),
      port: Number(port),
      queryPort: queryPort ? Number(queryPort) : 0,
      isRanked: isRanked !== undefined ? Boolean(isRanked) : true,
      maxPlayers: maxPlayers ? Number(maxPlayers) : 64
    });

    return reply.code(201).send({
      server,
      secretKey: server.secretKey
    });
  });

  // Dedicated server heartbeat update
  fastify.post('/heartbeat', async (request, reply) => {
    const secretKeyHeader = request.headers['x-server-secret'] as string;
    const body = request.body as any || {};
    const secretKey = secretKeyHeader || body.secretKey;

    if (!secretKey) {
      return reply.code(401).send({ error: 'Server secret key is required (X-Server-Secret header or secretKey in body)' });
    }

    const server = await fastify.serverRepo.findBySecretKey(secretKey);
    if (!server) {
      return reply.code(404).send({ error: 'Server not found or invalid secret key' });
    }

    const metadata: any = {};
    if (body.name) metadata.name = body.name;
    if (body.currentPlayers !== undefined) metadata.currentPlayers = Number(body.currentPlayers);
    if (body.maxPlayers !== undefined) metadata.maxPlayers = Number(body.maxPlayers);
    if (body.mapName) metadata.mapName = body.mapName;
    if (body.gameMode) metadata.gameMode = body.gameMode;
    if (body.subState) metadata.subState = body.subState;
    if (body.details) metadata.details = body.details;

    await fastify.serverRepo.updateHeartbeat(server.id, metadata);

    return reply.send({
      success: true,
      serverId: server.id,
      timestamp: new Date().toISOString()
    });
  });
};
