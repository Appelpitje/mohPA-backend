import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { CompactServer } from './compact-list.js';
import { GameServerRegistry, normalizeIp } from './server-registry.js';
import { GoaCrypt, LIST_CHALLENGE_LEN, mixListChallenge } from './goa-crypt.js';
import { MOHPA_SECKEY } from './enctype2.js';

export const SB_PORT = 28910;
export const SERVER_LIST_REQUEST = 0;
export const NO_SERVER_LIST = 2;
export const UNSOLICITED_UDP_FLAG = 1;
export const NONSTANDARD_PORT_FLAG = 16;
export const LAST_SERVER_MARKER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
export const MOHPA_DEFAULT_QUERY_PORT = 13300;

function ipToBytes(ip: string): Buffer {
  const parts = normalizeIp(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return Buffer.from([0, 0, 0, 0]);
  }
  return Buffer.from(parts);
}

function readNts(buf: Buffer, offset: number): { value: string; next: number } | null {
  const end = buf.indexOf(0, offset);
  if (end < 0) return null;
  return { value: buf.subarray(offset, end).toString('ascii'), next: end + 1 };
}

export interface SbListRequest {
  queryGame: string;
  fromGame: string;
  challenge: Buffer;
  filter: string;
  fields: string;
  options: number;
}

export function parseSbListRequest(packet: Buffer): SbListRequest | null {
  if (packet.length < 3) return null;
  const total = packet.readUInt16BE(0);
  if (total > packet.length || total < 3) return null;
  if (packet[2] !== SERVER_LIST_REQUEST) return null;
  let offset = 3;
  if (offset + 2 + 4 > packet.length) return null;
  offset += 1; // protocol
  offset += 1; // encoding
  offset += 4; // gamever LE
  const queryGame = readNts(packet, offset);
  if (!queryGame) return null;
  offset = queryGame.next;
  const fromGame = readNts(packet, offset);
  if (!fromGame) return null;
  offset = fromGame.next;
  if (offset + LIST_CHALLENGE_LEN > packet.length) return null;
  const challenge = Buffer.from(packet.subarray(offset, offset + LIST_CHALLENGE_LEN));
  offset += LIST_CHALLENGE_LEN;
  const filter = readNts(packet, offset);
  if (!filter) return null;
  offset = filter.next;
  const fields = readNts(packet, offset);
  if (!fields) return null;
  offset = fields.next;
  if (offset + 4 > packet.length) return null;
  const options = packet.readUInt32BE(offset);
  return {
    queryGame: queryGame.value,
    fromGame: fromGame.value,
    challenge,
    filter: filter.value,
    fields: fields.value,
    options,
  };
}

export function buildCryptHeader(randomBytes: Buffer, serverKey: Buffer): Buffer {
  const header = Buffer.alloc(2 + randomBytes.length + serverKey.length);
  header[0] = randomBytes.length ^ 0xec;
  randomBytes.copy(header, 1);
  header[1 + randomBytes.length] = serverKey.length ^ 0xea;
  serverKey.copy(header, 2 + randomBytes.length);
  return header;
}

export function buildListPayload(clientIp: string, defaultPort: number, servers: CompactServer[]): Buffer {
  const chunks: Buffer[] = [];
  const ip = ipToBytes(clientIp);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(defaultPort & 0xffff, 0);
  chunks.push(ip, port);
  chunks.push(Buffer.from([0])); // no keys
  chunks.push(Buffer.from([0])); // no popular values
  for (const server of servers) {
    const flags = Buffer.from([UNSOLICITED_UDP_FLAG | NONSTANDARD_PORT_FLAG]);
    const addr = ipToBytes(server.ip);
    const sp = Buffer.alloc(2);
    sp.writeUInt16BE(server.port & 0xffff, 0);
    chunks.push(flags, addr, sp);
  }
  chunks.push(Buffer.from([0]), LAST_SERVER_MARKER);
  return Buffer.concat(chunks);
}

export function wrapServerListReply(
  clientChallenge: Buffer,
  clientIp: string,
  defaultPort: number,
  servers: CompactServer[],
  seckey = MOHPA_SECKEY,
  serverKey?: Buffer,
  randomBytes?: Buffer
): Buffer {
  const key = serverKey ?? crypto.randomBytes(8);
  const random = randomBytes ?? Buffer.concat([Buffer.from([0, 0]), crypto.randomBytes(6)]);
  const header = buildCryptHeader(random, key);
  const payload = buildListPayload(clientIp, defaultPort, servers);
  const mixed = mixListChallenge(clientChallenge, key, seckey);
  const crypt = new GoaCrypt();
  crypt.init(mixed);
  crypt.encrypt(payload);
  return Buffer.concat([header, payload]);
}

/** Client-side unwrap of an SB v2 list (sb_serverlist.c ProcessMainListData). */
export function unwrapServerListReply(
  packet: Buffer,
  clientChallenge: Buffer,
  seckey = MOHPA_SECKEY
): { clientIp: string; defaultPort: number; servers: CompactServer[] } | null {
  if (packet.length < 1) return null;
  const randomLen = packet[0] ^ 0xec;
  const reqlen = randomLen + 2;
  if (packet.length < reqlen) return null;
  const keylen = packet[reqlen - 1] ^ 0xea;
  const headerLen = reqlen + keylen;
  if (packet.length < headerLen) return null;
  const serverKey = packet.subarray(reqlen, headerLen);
  const payload = Buffer.from(packet.subarray(headerLen));
  const mixed = mixListChallenge(clientChallenge, serverKey, seckey);
  const crypt = new GoaCrypt();
  crypt.init(mixed);
  crypt.decrypt(payload);
  if (payload.length < 6) return null;
  const clientIp = `${payload[0]}.${payload[1]}.${payload[2]}.${payload[3]}`;
  const defaultPort = payload.readUInt16BE(4);
  let offset = 6;
  if (offset >= payload.length) return { clientIp, defaultPort, servers: [] };
  const numKeys = payload[offset++];
  for (let i = 0; i < numKeys; i++) {
    if (offset + 2 > payload.length) return null;
    const z = payload.indexOf(0, offset + 1);
    if (z < 0) return null;
    offset = z + 1;
  }
  if (offset >= payload.length) return { clientIp, defaultPort, servers: [] };
  const numPopular = payload[offset++];
  for (let i = 0; i < numPopular; i++) {
    const z = payload.indexOf(0, offset);
    if (z < 0) return null;
    offset = z + 1;
  }
  const servers: CompactServer[] = [];
  while (offset + 5 <= payload.length) {
    const flags = payload[offset];
    if (payload.subarray(offset + 1, offset + 5).equals(LAST_SERVER_MARKER)) {
      break;
    }
    offset += 1;
    const ip = `${payload[offset]}.${payload[offset + 1]}.${payload[offset + 2]}.${payload[offset + 3]}`;
    offset += 4;
    let port = defaultPort;
    if (flags & NONSTANDARD_PORT_FLAG) {
      if (offset + 2 > payload.length) break;
      port = payload.readUInt16BE(offset);
      offset += 2;
    }
    servers.push({ ip, port });
  }
  return { clientIp, defaultPort, servers };
}

export class GsServerBrowser {
  private server: net.Server | null = null;
  private connections = new Set<net.Socket>();
  private registry: GameServerRegistry;

  constructor(registry?: GameServerRegistry) {
    this.registry = registry ?? new GameServerRegistry();
  }

  public start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', reject);
      this.server.listen(port, host, () => {
        console.log(`[GsSB] GameSpy server browsing listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    socket.setNoDelay(true);
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[GsSB] Connection from ${remote}`);
    let buf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const total = buf.readUInt16BE(0);
        if (total < 3 || total > 4096) {
          console.warn(`[GsSB] [${remote}] bad length ${total}`);
          socket.destroy();
          return;
        }
        if (buf.length < total) return;
        const packet = buf.subarray(0, total);
        buf = buf.subarray(total);
        const type = packet[2];
        if (type === SERVER_LIST_REQUEST) {
          const req = parseSbListRequest(packet);
          if (!req) {
            console.warn(`[GsSB] [${remote}] unparseable list request`);
            continue;
          }
          const clientIp = normalizeIp(socket.remoteAddress || '0.0.0.0');
          const skipList = (req.options & NO_SERVER_LIST) !== 0;
          const servers = skipList ? [] : this.registry.list(req.queryGame || 'mohpa');
          const reply = wrapServerListReply(
            req.challenge,
            clientIp,
            MOHPA_DEFAULT_QUERY_PORT,
            servers
          );
          console.log(
            `[GsSB] [${remote}] list queryGame=${req.queryGame} fields=${JSON.stringify(req.fields)} options=${req.options} servers=${servers.length} reply=${reply.length}b`
          );
          socket.write(reply);
        } else {
          console.log(`[GsSB] [${remote}] type=0x${type.toString(16)} ${packet.length}b`);
        }
      }
    });
    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[GsSB] Connection closed ${remote}`);
    });
    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }
}
