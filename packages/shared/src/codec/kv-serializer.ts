/**
 * Key-Value ASCII Serializer and Deserializer for EA FESL & Theater Protocols
 */

import { FeslErrorItem } from '../types/index.js';

export interface KVSerializeOptions {
  quoteStrings?: boolean; // Always quote string values
  urlEncode?: boolean;    // Percent-encode special characters
  lineEnding?: '\n' | '\r\n';
}

export interface KVDeserializeOptions {
  parseNumbers?: boolean; // Automatically parse numeric strings to numbers (default: true)
  parseBooleans?: boolean; // Automatically parse 'true'/'false' to booleans (default: false)
  urlDecode?: boolean;    // Automatically decode percent-encoded strings (default: true)
}

/**
 * Parses an ASCII KV payload into a structured nested JavaScript object.
 */
export function deserializeKV(
  data: string | Buffer,
  options: KVDeserializeOptions = {}
): Record<string, any> {
  const { parseNumbers = true, parseBooleans = false, urlDecode = true } = options;
  const text = typeof data === 'string' ? data : data.toString('utf8');
  const lines = text.split(/\r?\n/);
  const result: Record<string, any> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const rawKey = line.slice(0, eqIndex).trim();
    const rawValue = line.slice(eqIndex + 1);

    const parsedValue = parseValue(rawValue, { parseNumbers, parseBooleans, urlDecode });
    assignPath(result, rawKey, parsedValue);
  }

  return normalizeArrays(result);
}

/**
 * Alias for deserializeKV matching legacy naming.
 */
export const parseKvPayload = deserializeKV;

/**
 * Serializes a JavaScript object into FESL ASCII key-value lines.
 */
export function serializeKV(
  obj: Record<string, any>,
  options: KVSerializeOptions = {}
): string {
  const { quoteStrings = false, lineEnding = '\n' } = options;
  const lines: string[] = [];

  function processNode(prefix: string, value: any) {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        // Empty array handling (special case for errorContainer or standard .[])
        if (prefix === 'errorContainer') {
          lines.push('errorContainer=[]');
        } else if (prefix) {
          lines.push(`${prefix}.[]=0`);
        }
        return;
      }

      // Output array length count
      if (prefix) {
        lines.push(`${prefix}.[]=${value.length}`);
      }

      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const itemKey = prefix ? `${prefix}.${i}` : `${i}`;
        if (typeof item === 'object' && item !== null && !(item instanceof Date)) {
          processNode(itemKey, item);
        } else {
          lines.push(`${itemKey}=${formatValue(item, quoteStrings)}`);
        }
      }
      return;
    }

    if (typeof value === 'object' && !(value instanceof Date)) {
      for (const [key, subVal] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        processNode(path, subVal);
      }
      return;
    }

    // Primitive value
    const lineKey = prefix;
    lines.push(`${lineKey}=${formatValue(value, quoteStrings)}`);
  }

  processNode('', obj);
  return lines.join(lineEnding) + (lines.length > 0 ? lineEnding : '');
}

/**
 * Alias for serializeKV matching legacy naming.
 */
export const formatKvPayload = serializeKV;

/**
 * Parses individual value strings, handling quotes, escaping, and types.
 */
function parseValue(
  val: string,
  options: { parseNumbers: boolean; parseBooleans: boolean; urlDecode: boolean }
): any {
  let trimmed = val.trim();

  // Handle empty array marker: `errorContainer=[]` or `foo=[]`
  if (trimmed === '[]') {
    return [];
  }

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    const unquoted = trimmed.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
    return options.urlDecode ? safeUrlDecode(unquoted) : unquoted;
  }

  // Handle URL decoded raw string if percent encoded
  if (options.urlDecode && trimmed.includes('%')) {
    trimmed = safeUrlDecode(trimmed);
  }

  if (options.parseBooleans) {
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
  }

  if (options.parseNumbers) {
    // Check if integer or float without leading zeroes (unless "0")
    if (/^-?\d+$/.test(trimmed) && (trimmed === '0' || !trimmed.startsWith('0') || trimmed === '-0')) {
      const num = Number(trimmed);
      if (Number.isSafeInteger(num)) return num;
    } else if (/^-?\d+\.\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isNaN(num)) return num;
    }
  }

  return trimmed;
}

/**
 * Formats a value for serialization.
 */
function formatValue(val: any, quoteStrings: boolean): string {
  if (val === null || val === undefined) {
    return '""';
  }

  if (val instanceof Date) {
    return `"${val.toISOString()}"`;
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }

  const str = String(val);
  // If quoting is forced or if string has spaces, quotes, or newlines
  if (quoteStrings || /[\s"'\r\n=]/.test(str) || str.length === 0) {
    const escaped = str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }

  return str;
}

/**
 * Assigns a value along a dotted path, creating objects or array markers.
 */
function assignPath(target: Record<string, any>, rawPath: string, value: any): void {
  // Check for array length declarations like `personas.[] = 2` or `errorContainer.[] = 0`
  if (rawPath.endsWith('.[]')) {
    const basePath = rawPath.slice(0, -3);
    const count = typeof value === 'number' ? value : parseInt(value, 10) || 0;
    ensureArrayCapacity(target, basePath, count);
    return;
  }

  const parts = rawPath.split('.');
  let current = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isNextNumeric = /^\d+$/.test(nextPart);

    if (current[part] === undefined || current[part] === null) {
      current[part] = isNextNumeric ? [] : {};
    }

    current = current[part];
  }

  const lastKey = parts[parts.length - 1];
  current[lastKey] = value;
}

/**
 * Ensures an array exists at a path with expected capacity marker.
 */
function ensureArrayCapacity(target: Record<string, any>, path: string, _count: number): void {
  const parts = path.split('.');
  let current = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastKey = parts[parts.length - 1];
  if (!Array.isArray(current[lastKey])) {
    current[lastKey] = [];
  }
}

/**
 * Normalizes objects with all-numeric keys to real JavaScript arrays.
 */
function normalizeArrays(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(normalizeArrays);
  }

  const keys = Object.keys(obj);
  if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
    const maxIdx = Math.max(...keys.map(k => parseInt(k, 10)));
    const arr: any[] = [];
    for (let i = 0; i <= maxIdx; i++) {
      arr.push(normalizeArrays(obj[i]));
    }
    return arr;
  }

  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = normalizeArrays(v);
  }
  return result;
}

function safeUrlDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Helper to build standard FESL errorContainer structures.
 */
export function formatErrorContainer(errors: FeslErrorItem[] = []): Record<string, any> {
  if (errors.length === 0) {
    return { errorContainer: [] };
  }
  return {
    errorContainer: errors.map(err => ({
      fieldName: err.fieldName,
      fieldError: err.fieldError,
      ...(err.message ? { message: err.message } : {})
    }))
  };
}
