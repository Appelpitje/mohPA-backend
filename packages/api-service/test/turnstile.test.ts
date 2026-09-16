import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyTurnstileToken } from '../src/services/turnstile.js';

describe('verifyTurnstileToken', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips Siteverify when no secret is configured', async () => {
    await expect(verifyTurnstileToken({ token: undefined, secret: '' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when CAPTCHA is required but no secret is configured', async () => {
    await expect(
      verifyTurnstileToken({ token: 'XXXX.DUMMY.TOKEN.XXXX', secret: '', required: true })
    ).rejects.toMatchObject({
      message: 'CAPTCHA is not configured',
      statusCode: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing token when a secret is configured', async () => {
    await expect(
      verifyTurnstileToken({ token: '  ', secret: 'turnstile-secret' })
    ).rejects.toMatchObject({
      message: 'CAPTCHA verification is required',
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when Cloudflare Siteverify returns success=false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    await expect(
      verifyTurnstileToken({ token: 'bad-token', secret: 'turnstile-secret', remoteip: '203.0.113.10' })
    ).rejects.toMatchObject({
      message: 'CAPTCHA verification failed',
      statusCode: 400,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(init.body.toString()).toContain('secret=turnstile-secret');
    expect(init.body.toString()).toContain('response=bad-token');
    expect(init.body.toString()).toContain('remoteip=203.0.113.10');
  });

  it('accepts a token when Cloudflare Siteverify returns success=true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      verifyTurnstileToken({ token: 'XXXX.DUMMY.TOKEN.XXXX', secret: 'turnstile-secret' })
    ).resolves.toBeUndefined();
  });
});
