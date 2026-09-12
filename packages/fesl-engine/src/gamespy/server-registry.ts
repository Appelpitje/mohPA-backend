import { CompactServer, encodeCompactList } from './compact-list.js';

export interface ListedGameServer extends CompactServer {
  gamename: string;
  gamePort?: number;
  lastHeartbeat: number;
}

export interface GameServerRegistryOptions {
  publicIp?: string;
  staleMs?: number;
}

const DEFAULT_STALE_MS = 3 * 60 * 1000;

export function normalizeIp(ip: string): string {
  if (!ip) return ip;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export function isPrivateOrLocalIp(ip: string): boolean {
  const value = normalizeIp(ip);
  if (value === '127.0.0.1' || value === '0.0.0.0' || value === 'localhost') return true;
  if (value.startsWith('10.')) return true;
  if (value.startsWith('192.168.')) return true;
  if (value.startsWith('169.254.')) return true;
  if (value.startsWith('172.')) {
    const second = Number(value.split('.')[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

export function rewriteAdvertisedIp(ip: string, publicIp?: string): string {
  const value = normalizeIp(ip);
  if (publicIp && isPrivateOrLocalIp(value)) {
    return publicIp;
  }
  return value;
}

export class GameServerRegistry {
  private servers = new Map<string, ListedGameServer>();
  private publicIp: string;
  private staleMs: number;

  constructor(options: GameServerRegistryOptions = {}) {
    this.publicIp = options.publicIp || '';
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  }

  public setPublicIp(ip: string): void {
    this.publicIp = ip;
  }

  public upsert(server: {
    ip: string;
    port: number;
    gamename?: string;
    gamePort?: number;
  }): ListedGameServer {
    const ip = rewriteAdvertisedIp(server.ip, this.publicIp);
    const port = Number(server.port);
    const gamename = (server.gamename || 'mohpa').toLowerCase();
    const key = `${gamename}|${ip}|${port}`;
    const listed: ListedGameServer = {
      ip,
      port,
      gamename,
      gamePort: server.gamePort,
      lastHeartbeat: Date.now(),
    };
    this.servers.set(key, listed);
    return listed;
  }

  public remove(ip: string, port: number, gamename = 'mohpa'): void {
    const rewritten = rewriteAdvertisedIp(ip, this.publicIp);
    this.servers.delete(`${gamename.toLowerCase()}|${rewritten}|${port}`);
    this.servers.delete(`${gamename.toLowerCase()}|${normalizeIp(ip)}|${port}`);
  }

  public list(gamename?: string): CompactServer[] {
    const now = Date.now();
    const want = gamename ? gamename.toLowerCase() : undefined;
    const out: CompactServer[] = [];
    for (const [key, server] of this.servers) {
      if (now - server.lastHeartbeat > this.staleMs) {
        this.servers.delete(key);
        continue;
      }
      if (want && server.gamename !== want) continue;
      out.push({ ip: server.ip, port: server.port });
    }
    return out;
  }

  public encodeList(gamename?: string): Buffer {
    return encodeCompactList(this.list(gamename));
  }

  public size(): number {
    return this.list().length;
  }
}
