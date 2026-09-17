const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pass',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'secret',
  'token',
  'authtoken',
  'authorization',
  'turnstiletoken',
  'encryptedinfo',
  'lkey',
  'lt',
  'proof',
  'response',
  'sesskey',
  'jwt',
  'jwttoken',
  'internalapikey',
  'masterkey',
  'writekey',
  'readkey',
]);

function normalizeKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Returns a deep clone with credentials and session secrets replaced.
 * Does not mutate the input.
 */
export function redactSensitive<T>(value: T): T {
  return redactValue(value) as T;
}

const FESL_SENSITIVE_KV =
  /(^|[;\n\r&])((?:password|passwd|pass|currentPassword|newPassword|passwordHash|secret|token|authtoken|authorization|turnstileToken|encryptedInfo|lkey|lt|proof|sesskey|jwt)[^=\n\r;]*?)=([^\n\r;&]*)/gi;

const GAMESPY_SENSITIVE_KV =
  /\\(password|passwd|pass|secret|token|authtoken|authorization|lkey|lt|proof|response|sesskey|encryptedInfo)\\[^\\]*/gi;

/**
 * Redacts credential fields in FESL key=value and GameSpy \\key\\value dumps.
 */
export function redactSensitiveString(text: string): string {
  if (!text) return text;
  return text
    .replace(FESL_SENSITIVE_KV, '$1$2=[REDACTED]')
    .replace(GAMESPY_SENSITIVE_KV, '\\$1\\[REDACTED]');
}
