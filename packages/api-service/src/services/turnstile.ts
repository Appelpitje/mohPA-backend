/**
 * Cloudflare Turnstile token verification against Siteverify.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'TurnstileError';
    this.statusCode = statusCode;
  }
}

export async function verifyTurnstileToken(options: {
  token?: string;
  secret?: string;
  remoteip?: string;
  required?: boolean;
}): Promise<void> {
  const secret = options.secret?.trim();
  if (!secret) {
    if (options.required) {
      throw new TurnstileError('CAPTCHA is not configured', 503);
    }
    return;
  }

  const token = options.token?.trim();
  if (!token) {
    throw new TurnstileError('CAPTCHA verification is required');
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (options.remoteip) {
    body.set('remoteip', options.remoteip);
  }

  const response = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    body,
  });

  const result = (await response.json()) as { success?: boolean };
  if (!result.success) {
    throw new TurnstileError('CAPTCHA verification failed');
  }
}
