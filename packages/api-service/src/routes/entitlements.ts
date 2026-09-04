/**
 * CentralSpy Entitlements & CD Keys REST Routes (/api/v1/entitlements)
 */

import { FastifyPluginAsync } from 'fastify';
import { getGameConfig } from '@centralspy/shared';

export const entitlementRoutes: FastifyPluginAsync = async (fastify) => {
  // Claim a CD Key
  fastify.post('/claim', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const { cdKey, gameSlug } = request.body as any || {};

    if (!cdKey || typeof cdKey !== 'string') {
      return reply.code(400).send({ error: 'cdKey is required' });
    }

    if (gameSlug) {
      const config = getGameConfig(gameSlug);
      if (!config) {
        return reply.code(400).send({ error: `Unknown game slug: ${gameSlug}` });
      }
    }

    try {
      const entitlement = await fastify.entitlementRepo.claimKey(userId, cdKey, gameSlug);
      if (!entitlement) {
        return reply.code(400).send({ error: 'Unable to claim this CD key' });
      }
      return reply.send({ success: true, entitlement });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // List current user's entitlements
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const entitlements = await fastify.entitlementRepo.findByUserId(userId);
    return reply.send({ entitlements });
  });

  // Grant game license to self (dev / ease-of-use)
  fastify.post('/grant', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const { gameSlug } = request.body as any || {};

    if (!gameSlug || typeof gameSlug !== 'string') {
      return reply.code(400).send({ error: 'gameSlug is required' });
    }

    const config = getGameConfig(gameSlug);
    if (!config) {
      return reply.code(400).send({ error: `Unknown game slug: ${gameSlug}` });
    }

    const entitlement = await fastify.entitlementRepo.grantUserGame(userId, config.slug);
    return reply.send({ success: true, entitlement });
  });
};
