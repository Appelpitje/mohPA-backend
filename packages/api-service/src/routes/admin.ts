/**
 * mohPA Admin & Moderation REST Routes (/api/v1/admin)
 */

import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Enforce admin authentication across all admin routes
  fastify.addHook('preHandler', fastify.authenticateAdmin);

  // Active Sessions & Inspector stats
  fastify.get('/sessions', async (request, reply) => {
    const inspectorStats = fastify.inspectorHub.getStats();
    const onlineServers = await fastify.serverRepo.listServers({ isOnline: true });

    return reply.send({
      inspector: inspectorStats,
      onlineServersCount: onlineServers.length,
      onlineServers
    });
  });

  // Issue Ban
  fastify.post('/bans', async (request, reply) => {
    const actorId = (request.user as any).id;
    const { userId, reason } = request.body as any || {};

    if (!userId) {
      return reply.code(400).send({ error: 'userId is required' });
    }

    const user = await fastify.userRepo.findById(userId);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    await fastify.userRepo.setBanned(userId, true);
    await fastify.statsRepo.logAudit({
      actorId,
      action: 'BAN_USER',
      targetType: 'USER',
      targetId: userId,
      details: { reason: reason || 'Banned by administrator', username: user.username }
    });

    return reply.send({
      success: true,
      message: `User ${user.username} has been banned`,
      userId
    });
  });

  // Revoke Ban
  fastify.delete('/bans/:id', async (request, reply) => {
    const actorId = (request.user as any).id;
    const { id } = request.params as any;

    const user = await fastify.userRepo.findById(id);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    await fastify.userRepo.setBanned(id, false);
    await fastify.statsRepo.logAudit({
      actorId,
      action: 'UNBAN_USER',
      targetType: 'USER',
      targetId: id,
      details: { username: user.username }
    });

    return reply.send({
      success: true,
      message: `User ${user.username} has been unbanned`,
      userId: id
    });
  });

  // Disconnect / Kick Player
  fastify.post('/kick', async (request, reply) => {
    const actorId = (request.user as any).id;
    const { userId, personaId, reason } = request.body as any || {};

    if (!userId && !personaId) {
      return reply.code(400).send({ error: 'userId or personaId is required' });
    }

    // Broadcast kick event on inspector WebSocket
    fastify.inspectorHub.broadcastPacket({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol: 'THEATER',
      direction: 'OUTGOING',
      clientIp: '127.0.0.1',
      clientPort: 0,
      subsystemOrCommand: 'KICK',
      subtypeOrTxn: 'ADMIN_KICK',
      length: 0,
      payload: { userId, personaId, reason: reason || 'Kicked by administrator' }
    });

    await fastify.statsRepo.logAudit({
      actorId,
      action: 'KICK_PLAYER',
      targetType: userId ? 'USER' : 'PERSONA',
      targetId: userId || personaId,
      details: { reason: reason || 'Kicked by administrator' }
    });

    return reply.send({
      success: true,
      message: 'Kick command dispatched'
    });
  });

  // Create / Generate Server Authentication Key
  fastify.post('/server-keys', async (request, reply) => {
    const actorId = (request.user as any).id;
    const { serverName, gameSlug, ipAddress, port, isRanked, maxPlayers } = request.body as any || {};

    if (!serverName || !gameSlug || !ipAddress || !port) {
      return reply.code(400).send({ error: 'serverName, gameSlug, ipAddress, and port are required' });
    }

    const secretKey = `CS-SRV-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;

    const server = await fastify.serverRepo.register({
      name: serverName,
      gameSlug,
      ipAddress,
      port: Number(port),
      secretKey,
      isRanked: isRanked !== undefined ? Boolean(isRanked) : true,
      maxPlayers: maxPlayers ? Number(maxPlayers) : 64
    });

    await fastify.statsRepo.logAudit({
      actorId,
      action: 'CREATE_SERVER_KEY',
      targetType: 'SERVER',
      targetId: server.id,
      details: { serverName, gameSlug, ipAddress, port }
    });

    return reply.code(201).send({
      server,
      secretKey
    });
  });

  // Get Audit Logs
  fastify.get('/audit-logs', async (request, reply) => {
    const query = request.query as any || {};
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const logs = await fastify.statsRepo.getAuditLogs(limit, offset);
    return reply.send({ logs, count: logs.length });
  });
};
