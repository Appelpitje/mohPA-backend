/**
 * mohPA Auth REST Routes (/api/v1/auth)
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { TurnstileError, verifyTurnstileToken } from '../services/turnstile.js';

async function requireTurnstile(
  fastify: { turnstileSecret: string; turnstileRequired: boolean },
  request: FastifyRequest,
  reply: FastifyReply,
  token?: string
): Promise<boolean> {
  try {
    await verifyTurnstileToken({
      token,
      secret: fastify.turnstileSecret,
      remoteip: request.ip,
      required: fastify.turnstileRequired,
    });
    return true;
  } catch (err) {
    if (err instanceof TurnstileError) {
      reply.code(err.statusCode).send({ error: err.message });
      return false;
    }
    throw err;
  }
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Register Account
  fastify.post('/register', async (request, reply) => {
    const { username, email, password, countryCode, dob, turnstileToken } = request.body as any || {};

    if (!(await requireTurnstile(fastify, request, reply, turnstileToken))) {
      return;
    }

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return reply.code(400).send({ error: 'Username must be at least 3 characters long' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return reply.code(400).send({ error: 'A valid email address is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return reply.code(400).send({ error: 'Password must be at least 6 characters long' });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check existing username
    const existingUsername = await fastify.userRepo.findByUsername(cleanUsername);
    if (existingUsername) {
      return reply.code(409).send({ error: 'Username is already taken' });
    }

    // Check existing email
    const existingEmail = await fastify.userRepo.findByEmail(cleanEmail);
    if (existingEmail) {
      return reply.code(409).send({ error: 'Email address is already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await fastify.userRepo.create({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      countryCode: countryCode ? String(countryCode).toUpperCase().slice(0, 4) : 'US',
      dob: dob || '2000-01-01'
    });

    const token = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin
    });

    return reply.code(201).send({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        countryCode: user.countryCode,
        dob: user.dob,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      }
    });
  });

  // Login
  fastify.post('/login', async (request, reply) => {
    const { identifier, username, email, password, turnstileToken } = request.body as any || {};
    const loginId = (identifier || username || email || '').trim();

    if (!(await requireTurnstile(fastify, request, reply, turnstileToken))) {
      return;
    }

    if (!loginId || !password) {
      return reply.code(400).send({ error: 'Username/Email and Password are required' });
    }

    const user = await fastify.userRepo.findByUsernameOrEmail(loginId);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    if (user.isBanned) {
      return reply.code(403).send({ error: 'This account has been suspended' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const token = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        countryCode: user.countryCode,
        dob: user.dob,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      }
    });
  });

  // Get Current User Profile & Entitlements
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const user = await fastify.userRepo.findById(userId);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const entitlements = await fastify.entitlementRepo.findByUserId(userId);
    const personas = await fastify.personaRepo.findByUserId(userId);

    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        countryCode: user.countryCode,
        dob: user.dob,
        isAdmin: user.isAdmin,
        isBanned: user.isBanned,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      entitlements,
      personas
    });
  });

  // Update Profile
  fastify.put('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const { email, countryCode, dob, currentPassword, newPassword } = request.body as any || {};

    const user = await fastify.userRepo.findById(userId);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const updates: any = {};

    if (email && email.trim() !== user.email) {
      const cleanEmail = email.trim().toLowerCase();
      const existing = await fastify.userRepo.findByEmail(cleanEmail);
      if (existing && existing.id !== userId) {
        return reply.code(409).send({ error: 'Email is already in use' });
      }
      updates.email = cleanEmail;
    }

    if (countryCode) {
      updates.countryCode = String(countryCode).toUpperCase().slice(0, 4);
    }

    if (dob) {
      updates.dob = dob;
    }

    if (newPassword) {
      if (!currentPassword) {
        return reply.code(400).send({ error: 'Current password is required to set a new password' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return reply.code(401).send({ error: 'Current password does not match' });
      }
      if (newPassword.length < 6) {
        return reply.code(400).send({ error: 'New password must be at least 6 characters long' });
      }
      updates.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updated = await fastify.userRepo.update(userId, updates);
    return reply.send({
      user: updated ? {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        countryCode: updated.countryCode,
        dob: updated.dob,
        isAdmin: updated.isAdmin,
        updatedAt: updated.updatedAt
      } : null
    });
  });
};
