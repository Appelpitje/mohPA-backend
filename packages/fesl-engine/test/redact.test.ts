import { describe, it, expect } from 'vitest';
import { redactSensitive, redactSensitiveString } from '../src/utils/redact.js';

describe('redactSensitive', () => {
  it('redacts password fields without mutating the original', () => {
    const payload = {
      TXN: 'NuLogin',
      nuid: 'player1',
      password: 'SuperSecretLoginPass99!',
    };

    const redacted = redactSensitive(payload);

    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.nuid).toBe('player1');
    expect(payload.password).toBe('SuperSecretLoginPass99!');
  });

  it('redacts session tokens, authtokens, and password hashes', () => {
    const redacted = redactSensitive({
      lkey: 'session-lkey-value',
      authtoken: 'gs-authtoken-value',
      passwordHash: '$2b$10$abcdef',
      username: 'tommy',
    });

    expect(redacted.lkey).toBe('[REDACTED]');
    expect(redacted.authtoken).toBe('[REDACTED]');
    expect(redacted.passwordHash).toBe('[REDACTED]');
    expect(redacted.username).toBe('tommy');
  });

  it('redacts nested objects and GameSpy field maps', () => {
    const redacted = redactSensitive({
      login: '',
      challenge: 'client-challenge',
      response: 'md5-proof-from-password',
      nested: { token: 'jwt-here', nick: 'Player' },
    });

    expect(redacted.response).toBe('[REDACTED]');
    expect(redacted.nested.token).toBe('[REDACTED]');
    expect(redacted.nested.nick).toBe('Player');
    expect(redacted.challenge).toBe('client-challenge');
  });
});

describe('redactSensitiveString', () => {
  it('redacts FESL key=value password lines', () => {
    const raw = 'TXN=NuLogin\nnuid=player1\npassword=SuperSecretLoginPass99!\n';
    const redacted = redactSensitiveString(raw);

    expect(redacted).not.toContain('SuperSecretLoginPass99!');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).toContain('nuid=player1');
  });

  it('redacts GameSpy backslash password and authtoken fields', () => {
    const raw = '\\login\\\\password\\hunter2\\authtoken\\abc123\\nick\\Player\\final\\';
    const redacted = redactSensitiveString(raw);

    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('abc123');
    expect(redacted).toContain('\\password\\[REDACTED]');
    expect(redacted).toContain('\\authtoken\\[REDACTED]');
    expect(redacted).toContain('\\nick\\Player');
  });
});
