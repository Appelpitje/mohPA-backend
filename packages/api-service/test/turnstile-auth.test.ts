import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { MemoryDbClient } from '@mohpa/db';
import { buildServer } from '../src/server.js';

describe('Auth routes require Cloudflare Turnstile when configured', () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn();

  beforeAll(async () => {
    app = await buildServer({
      db: new MemoryDbClient(),
      jwtSecret: 'test-jwt-secret-12345',
      internalApiKey: 'test-internal-key-67890',
      turnstileSecret: 'turnstile-secret',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/v1/auth/register rejects missing CAPTCHA token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'CaptchaCommander',
        email: 'captcha@mohpa.net',
        password: 'SecretPassword123',
        countryCode: 'US',
        dob: '1990-01-01',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('CAPTCHA verification is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/v1/auth/login rejects a failed CAPTCHA token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'CaptchaCommander',
        password: 'SecretPassword123',
        turnstileToken: 'bad-token',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('CAPTCHA verification failed');
  });

  it('POST /api/v1/auth/register succeeds after a valid CAPTCHA token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'CaptchaCommander',
        email: 'captcha@mohpa.net',
        password: 'SecretPassword123',
        countryCode: 'US',
        dob: '1990-01-01',
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).token).toBeDefined();
  });

  it('POST /api/v1/auth/login succeeds after a valid CAPTCHA token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'CaptchaCommander',
        password: 'SecretPassword123',
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).token).toBeDefined();
  });
});
