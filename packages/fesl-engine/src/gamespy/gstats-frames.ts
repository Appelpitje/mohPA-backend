/** GameSpy gstats frames. DoSend XORs the body and appends a plaintext `\final\`. */

export const GSTATS_XOR_KEY = Buffer.from('GameSpy3D', 'ascii');

const FINAL = '\\final\\';
const COMMAND_ORDER = ['authp', 'getpid', 'getpd', 'setpd', 'newgame', 'updgame', 'auth'] as const;

export type GstatsCommand =
  | { type: 'auth'; gamename?: string; port?: string }
  | { type: 'newgame'; connid?: string; sesskey?: string; challenge?: string }
  | { type: 'updgame'; connid?: string; sesskey?: string; done: string; gamedata: string }
  | { type: 'getpd'; pid?: string; ptype?: string; dindex?: string; keys: string; lid?: string }
  | { type: 'setpd'; pid?: string; ptype?: string; dindex?: string; kv?: string; lid?: string; length?: string; data: string }
  | { type: 'authp'; pid?: string; nick?: string; lid?: string }
  | { type: 'getpid'; pid?: string; nick?: string; lid?: string };

const loggedAlignments = new Set<number>();

export function xorAlign(buf: Buffer, align: number): Buffer {
  const out = Buffer.from(buf);
  const key = GSTATS_XOR_KEY;
  for (let i = 0; i < out.length; i++) {
    out[i] ^= key[(i + align) % key.length];
  }
  return out;
}

export function field(decoded: string, key: string): string | undefined {
  const needle = `\\${key}\\`;
  const idx = decoded.indexOf(needle);
  if (idx < 0) return undefined;
  const start = idx + needle.length;
  const end = decoded.indexOf('\\', start);
  return decoded.slice(start, end < 0 ? undefined : end);
}

function fieldUntil(decoded: string, key: string, stops: string[]): string | undefined {
  const needle = `\\${key}\\`;
  const idx = decoded.indexOf(needle);
  if (idx < 0) return undefined;
  const start = idx + needle.length;
  let end = decoded.length;
  for (const stop of stops) {
    const at = decoded.indexOf(`\\${stop}\\`, start);
    if (at >= 0 && at < end) end = at;
  }
  return decoded.slice(start, end);
}

function hasKey(decoded: string, key: string): boolean {
  return decoded.includes(`\\${key}\\`);
}

export function parseGstatsCommand(decoded: string): GstatsCommand | null {
  let type: (typeof COMMAND_ORDER)[number] | undefined;
  for (const name of COMMAND_ORDER) {
    if (hasKey(decoded, name)) {
      type = name;
      break;
    }
  }
  if (!type) return null;

  if (type === 'auth') {
    return { type, gamename: field(decoded, 'gamename'), port: field(decoded, 'port') };
  }
  if (type === 'newgame') {
    return {
      type,
      connid: field(decoded, 'connid'),
      sesskey: field(decoded, 'sesskey'),
      challenge: field(decoded, 'challenge'),
    };
  }
  if (type === 'updgame') {
    const raw = fieldUntil(decoded, 'gamedata', ['dl']) ?? '';
    return {
      type,
      connid: field(decoded, 'connid'),
      sesskey: field(decoded, 'sesskey'),
      done: field(decoded, 'done') ?? '0',
      gamedata: raw.replace(/\x01/g, '\\'),
    };
  }
  if (type === 'getpd') {
    return {
      type,
      pid: field(decoded, 'pid'),
      ptype: field(decoded, 'ptype'),
      dindex: field(decoded, 'dindex'),
      keys: fieldUntil(decoded, 'keys', ['lid', 'mod']) ?? '',
      lid: field(decoded, 'lid'),
    };
  }
  if (type === 'setpd') {
    const length = field(decoded, 'length');
    const marker = '\\data\\';
    const at = decoded.indexOf(marker);
    let data = '';
    if (at >= 0) {
      const raw = decoded.slice(at + marker.length);
      const n = length != null && /^\d+$/.test(length) ? Number(length) : raw.length;
      data = raw.slice(0, n);
    }
    return {
      type,
      pid: field(decoded, 'pid'),
      ptype: field(decoded, 'ptype'),
      dindex: field(decoded, 'dindex'),
      kv: field(decoded, 'kv'),
      lid: field(decoded, 'lid'),
      length,
      data,
    };
  }
  if (type === 'authp') {
    return { type, pid: field(decoded, 'pid'), nick: field(decoded, 'nick'), lid: field(decoded, 'lid') };
  }
  return { type: 'getpid', pid: field(decoded, 'pid'), nick: field(decoded, 'nick'), lid: field(decoded, 'lid') };
}

export function decodeGstatsBody(body: Buffer): { command: GstatsCommand; alignment: number } | null {
  if (body.length === 0) return null;
  for (let align = 0; align <= 8; align++) {
    const text = xorAlign(body, align).toString('latin1');
    const command = parseGstatsCommand(text);
    if (!command) continue;
    if (!loggedAlignments.has(align)) {
      loggedAlignments.add(align);
      console.log(`[GsStats] XOR alignment ${align}`);
    }
    return { command, alignment: align };
  }
  return null;
}

export interface ParsedGstatsBuffer {
  frames: Array<{ command: GstatsCommand; alignment: number }>;
  rest: Buffer;
  unrecognized: Buffer[];
}

export function parseGstatsBuffer(buffer: Buffer): ParsedGstatsBuffer {
  const finalBuf = Buffer.from(FINAL, 'ascii');
  const frames: ParsedGstatsBuffer['frames'] = [];
  const unrecognized: Buffer[] = [];
  let buf = buffer;
  while (true) {
    const idx = buf.indexOf(finalBuf);
    if (idx < 0) break;
    const body = buf.subarray(0, idx);
    const parsed = body.length > 0 ? decodeGstatsBody(body) : null;
    if (parsed) frames.push(parsed);
    else if (body.length >= 8) unrecognized.push(Buffer.from(body));
    buf = buf.subarray(idx + finalBuf.length);
  }
  if (buf.length >= 8) {
    const parsed = decodeGstatsBody(buf);
    if (parsed) {
      frames.push(parsed);
      buf = Buffer.alloc(0);
    } else {
      unrecognized.push(Buffer.from(buf));
    }
  }
  return { frames, rest: buf, unrecognized };
}

export function rawHexLine(buf: Buffer): string {
  return `RAW ${buf.length}b hex=${buf.subarray(0, 64).toString('hex')}`;
}
