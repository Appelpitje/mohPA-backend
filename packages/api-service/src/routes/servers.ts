/**
 * CentralSpy Game Servers REST Routes (/api/v1/servers)
 */

import { FastifyPluginAsync } from 'fastify';
import { getGameConfig, queryGameServer, resolveIpLocation } from '@centralspy/shared';

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

    const rawServers = await fastify.serverRepo.listServers(filter);
    const servers = rawServers.map((srv) => {
      const geo = resolveIpLocation(srv.region || srv.details?.region || srv.countryCode || srv.ipAddress);
      const ping = srv.ping ?? srv.details?.ping ?? geo.estimatedPing;
      const tickRate = srv.tickRate ?? srv.details?.tickRate ?? (srv.details?.rules?.sv_fps ? Number(srv.details.rules.sv_fps) : 30);
      return {
        ...srv,
        region: srv.region || srv.details?.region || geo.region,
        countryCode: srv.countryCode || srv.details?.countryCode || geo.countryCode,
        country: srv.country || srv.details?.country || geo.country,
        city: srv.city || srv.details?.city || geo.city,
        ping,
        tickRate,
      };
    });

    return reply.send({
      servers,
      count: servers.length,
      limit: filter.limit,
      offset: filter.offset
    });
  });

  // Get server details with live scoreboard & metadata (supports ?refresh=true)
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const query = (request.query as any) || {};
    let server = await fastify.serverRepo.findById(id);
    if (!server) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    // Optional on-demand refresh via UDP query probe
    if (query.refresh === 'true') {
      const queryResult = await queryGameServer({
        host: server.ipAddress,
        port: server.port,
        queryPort: server.queryPort || undefined,
        gameSlug: server.gameSlug,
        timeoutMs: 1500,
      });

      if (queryResult.online) {
        const geo = resolveIpLocation(server.region || server.details?.region || server.countryCode || server.ipAddress);
        const tickRate = Number(
          queryResult.rules?.sv_fps ||
          queryResult.rules?.tickrate ||
          queryResult.rules?.fps ||
          server.tickRate ||
          server.details?.tickRate ||
          30
        );
        await fastify.serverRepo.updateServerQuery(server.id, {
          isOnline: true,
          name: queryResult.name || server.name,
          mapName: queryResult.mapName || server.mapName,
          gameMode: queryResult.gameMode || server.gameMode,
          currentPlayers: queryResult.currentPlayers,
          maxPlayers: queryResult.maxPlayers || server.maxPlayers,
          details: {
            ...(server.details || {}),
            players: queryResult.players,
            rules: queryResult.rules,
            ping: queryResult.ping,
            tickRate,
            region: server.region || server.details?.region || geo.region,
            countryCode: server.countryCode || server.details?.countryCode || geo.countryCode,
            country: server.country || server.details?.country || geo.country,
            city: server.city || server.details?.city || geo.city,
            queryProtocol: queryResult.protocol,
            queryPort: queryResult.queryPort,
            lastQueried: new Date().toISOString(),
          },
        });
        server = (await fastify.serverRepo.findById(id)) || server;
      }
    }

    const geo = resolveIpLocation(server.region || server.details?.region || server.countryCode || server.ipAddress);
    const enrichedServer = {
      ...server,
      region: server.region || server.details?.region || geo.region,
      countryCode: server.countryCode || server.details?.countryCode || geo.countryCode,
      country: server.country || server.details?.country || geo.country,
      city: server.city || server.details?.city || geo.city,
      ping: server.ping ?? server.details?.ping ?? geo.estimatedPing,
      tickRate: server.tickRate ?? server.details?.tickRate ?? (server.details?.rules?.sv_fps ? Number(server.details.rules.sv_fps) : 30),
    };

    return reply.send({
      server: enrichedServer,
      scoreboard: server.details?.players || [],
      rules: server.details?.rules || {}
    });
  });

  // On-demand UDP query probe for a specific server
  fastify.post('/:id/query', async (request, reply) => {
    const { id } = request.params as any;
    const { queryTimeoutMs } = (request.body as any) || {};

    const server = await fastify.serverRepo.findById(id);
    if (!server) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    const queryResult = await queryGameServer({
      host: server.ipAddress,
      port: server.port,
      queryPort: server.queryPort || undefined,
      gameSlug: server.gameSlug,
      timeoutMs: queryTimeoutMs ? Number(queryTimeoutMs) : 2000,
    });

    if (queryResult.online) {
      const geo = resolveIpLocation(server.region || server.details?.region || server.countryCode || server.ipAddress);
      const tickRate = Number(
        queryResult.rules?.sv_fps ||
        queryResult.rules?.tickrate ||
        queryResult.rules?.fps ||
        server.tickRate ||
        server.details?.tickRate ||
        30
      );
      const updatedDetails = {
        ...(server.details || {}),
        players: queryResult.players,
        rules: queryResult.rules,
        ping: queryResult.ping,
        tickRate,
        region: server.region || server.details?.region || geo.region,
        countryCode: server.countryCode || server.details?.countryCode || geo.countryCode,
        country: server.country || server.details?.country || geo.country,
        city: server.city || server.details?.city || geo.city,
        queryProtocol: queryResult.protocol,
        queryPort: queryResult.queryPort,
        lastQueried: new Date().toISOString(),
      };

      await fastify.serverRepo.updateServerQuery(server.id, {
        isOnline: true,
        name: queryResult.name || server.name,
        mapName: queryResult.mapName || server.mapName,
        gameMode: queryResult.gameMode || server.gameMode,
        currentPlayers: queryResult.currentPlayers,
        maxPlayers: queryResult.maxPlayers || server.maxPlayers,
        details: updatedDetails,
      });

      const updatedServer = await fastify.serverRepo.findById(id);
      return reply.send({
        success: true,
        online: true,
        server: updatedServer,
        scoreboard: queryResult.players,
        rules: queryResult.rules,
        ping: queryResult.ping,
      });
    } else {
      await fastify.serverRepo.updateServerQuery(server.id, {
        isOnline: false,
        details: {
          ...(server.details || {}),
          queryError: queryResult.error || 'Server did not respond to UDP query probe',
          lastQueried: new Date().toISOString(),
        },
      });

      const updatedServer = await fastify.serverRepo.findById(id);
      return reply.send({
        success: false,
        online: false,
        error: queryResult.error || 'Server is offline or unreachable',
        server: updatedServer,
      });
    }
  });

  // Register dedicated server (actively queries the server via UDP)
  fastify.post('/register', async (request, reply) => {
    const {
      name,
      gameSlug,
      ipAddress,
      port,
      queryPort,
      isRanked,
      maxPlayers,
      skipQuery,
      queryTimeoutMs,
      mapName: bodyMapName,
      gameMode: bodyGameMode,
      currentPlayers: bodyPlayers,
      region: bodyRegion,
      country: bodyCountry,
      countryCode: bodyCountryCode,
      city: bodyCity,
      ping: bodyPing,
      tickRate: bodyTickRate,
      details: bodyDetails,
    } = request.body as any || {};

    if (!name || !gameSlug || !ipAddress || !port) {
      return reply.code(400).send({ error: 'name, gameSlug, ipAddress, and port are required' });
    }

    const config = getGameConfig(gameSlug);
    if (!config) {
      return reply.code(400).send({ error: `Unknown game slug: ${gameSlug}` });
    }

    const targetIp = String(ipAddress).trim();
    const targetPort = Number(port);
    const targetQueryPort = queryPort ? Number(queryPort) : 0;

    let queried = false;
    let serverName = String(name).trim();
    let mapName = '';
    let gameMode = '';
    let currentPlayers = 0;
    let resolvedMaxPlayers = maxPlayers ? Number(maxPlayers) : 64;
    let isOnline = false;
    let serverDetails: Record<string, any> = { ...(bodyDetails || {}) };

    if (!skipQuery) {
      const queryResult = await queryGameServer({
        host: targetIp,
        port: targetPort,
        queryPort: targetQueryPort || undefined,
        gameSlug: config.slug,
        timeoutMs: queryTimeoutMs ? Number(queryTimeoutMs) : 1500,
      });

      if (queryResult.online) {
        queried = true;
        isOnline = true;
        if (queryResult.name) {
          serverName = queryResult.name;
        }
        if (queryResult.mapName) {
          mapName = queryResult.mapName;
        }
        if (queryResult.gameMode) {
          gameMode = queryResult.gameMode;
        }
        currentPlayers = queryResult.currentPlayers || 0;
        if (queryResult.maxPlayers) {
          resolvedMaxPlayers = queryResult.maxPlayers;
        }
        serverDetails = {
          ...serverDetails,
          players: queryResult.players || [],
          rules: queryResult.rules || {},
          ping: queryResult.ping,
          queryProtocol: queryResult.protocol,
          queryPort: queryResult.queryPort,
          lastQueried: new Date().toISOString(),
        };
      } else {
        // Server did not answer query: enrolled as offline
        isOnline = false;
        serverDetails = {
          ...serverDetails,
          queryError: queryResult.error || 'Server did not respond to UDP query probe',
          lastQueried: new Date().toISOString(),
        };
      }
    } else {
      isOnline = true;
      if (bodyMapName) mapName = String(bodyMapName);
      if (bodyGameMode) gameMode = String(bodyGameMode);
      if (bodyPlayers !== undefined) currentPlayers = Number(bodyPlayers);
    }

    const geo = resolveIpLocation(bodyRegion || bodyCountryCode || targetIp);
    const region = bodyRegion || serverDetails.region || geo.region;
    const countryCode = bodyCountryCode || serverDetails.countryCode || geo.countryCode;
    const country = bodyCountry || serverDetails.country || geo.country;
    const city = bodyCity || serverDetails.city || geo.city;
    const tickRate = Number(
      bodyTickRate ||
      serverDetails.tickRate ||
      serverDetails.rules?.sv_fps ||
      serverDetails.rules?.tickrate ||
      serverDetails.rules?.fps ||
      30
    );
    const ping = bodyPing !== undefined ? Number(bodyPing) : serverDetails.ping;

    serverDetails.region = region;
    serverDetails.countryCode = countryCode;
    serverDetails.country = country;
    if (city) serverDetails.city = city;
    serverDetails.tickRate = tickRate;
    if (ping !== undefined) serverDetails.ping = ping;

    const server = await fastify.serverRepo.register({
      name: serverName,
      gameSlug: config.slug,
      ipAddress: targetIp,
      port: targetPort,
      queryPort: targetQueryPort,
      isRanked: isRanked !== undefined ? Boolean(isRanked) : true,
      isOnline,
      maxPlayers: resolvedMaxPlayers,
      currentPlayers,
      mapName,
      gameMode,
      region,
      country,
      countryCode,
      city,
      ping,
      tickRate,
      details: serverDetails,
    });

    return reply.code(201).send({
      server,
      secretKey: server.secretKey,
      queried,
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
