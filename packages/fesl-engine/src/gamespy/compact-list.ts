/**
 * GameSpy GOA compact server list (gserverlist.c ServerListReadList).
 *
 * Each server is 6 bytes: IPv4 (network order) + port (uint16 BE), then `\final\`.
 */

export interface CompactServer {
  ip: string;
  port: number;
}

const FINAL = Buffer.from('\\final\\', 'ascii');

export function encodeCompactList(servers: CompactServer[]): Buffer {
  const chunks: Buffer[] = [];
  for (const server of servers) {
    const row = Buffer.alloc(6);
    const octets = server.ip.split('.').map((part) => Number(part));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      continue;
    }
    row[0] = octets[0];
    row[1] = octets[1];
    row[2] = octets[2];
    row[3] = octets[3];
    const port = server.port & 0xffff;
    row.writeUInt16BE(port, 4);
    chunks.push(row);
  }
  chunks.push(FINAL);
  return Buffer.concat(chunks);
}

export function decodeCompactList(buf: Buffer): CompactServer[] {
  const servers: CompactServer[] = [];
  let offset = 0;
  while (offset + 6 <= buf.length) {
    if (buf.subarray(offset, offset + FINAL.length).equals(FINAL)) {
      break;
    }
    servers.push({
      ip: `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`,
      port: buf.readUInt16BE(offset + 4),
    });
    offset += 6;
  }
  return servers;
}

export function parseGsKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = text.split('\\');
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if (parts[i]) {
      out[parts[i]] = parts[i + 1];
    }
  }
  return out;
}

export function parseQr2KeyValues(body: Buffer): Record<string, string> {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    if (i === body.length || body[i] === 0) {
      if (i > start) {
        fields.push(body.subarray(start, i).toString('ascii'));
      }
      start = i + 1;
    }
  }
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i]) {
      out[fields[i]] = fields[i + 1];
    }
  }
  return out;
}
