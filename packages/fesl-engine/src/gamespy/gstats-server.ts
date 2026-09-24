import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { GSTATS_XOR_KEY, parseGstatsBuffer, rawHexLine, xorAlign, type GstatsCommand } from './gstats-frames.js';
import { buildStatsReport, GstatsMatchBuffer, type StatsReportBody } from './stats-ingest.js';

export { GSTATS_XOR_KEY };

const FINAL = '\\final\\';

export function gstatsXcode(buf: Buffer): Buffer {
  return xorAlign(buf, 0);
}

export function gstatsValueForKey(decoded: string, key: string): string | undefined {
  const needle = `\\${key}\\`;
  const idx = decoded.indexOf(needle);
  if (idx < 0) return undefined;
  const start = idx + needle.length;
  const end = decoded.indexOf('\\', start);
  return decoded.slice(start, end < 0 ? undefined : end);
}

/**
 * 2004 InitStatsThink waits until at least 38 bytes have arrived before
 * decoding the challenge (gstats.c "Receive the 38 byte challenge").
 */
export function buildGstatsChallenge(challenge: string): Buffer {
  // 2004 InitStats recvs up to 64 bytes then XOR-decodes the whole recv.
  // Later SDKs wait for >= 38 bytes. Keep the plaintext in that window.
  const plain = Buffer.from(`\\challenge\\${challenge}\\id\\1`, 'ascii');
  if (plain.length < 38 || plain.length > 64) {
    throw new Error(`gstats challenge must be 38-64 bytes, got ${plain.length}`);
  }
  return gstatsXcode(plain);
}

export function buildGstatsSesskey(sesskey: number): Buffer {
  return gstatsXcode(Buffer.from(`\\sesskey\\${sesskey}\\id\\1`, 'ascii'));
}

/** Persist replies: XOR the body, then append plaintext \final\ (gstats.c DoSend). */
export function buildGstatsPersistReply(body: string): Buffer {
  return Buffer.concat([gstatsXcode(Buffer.from(body, 'ascii')), Buffer.from(FINAL, 'ascii')]);
}

export function gstatsPersistReplyFor(decoded: string): string | undefined {
  const lid = gstatsValueForKey(decoded, 'lid') || '1';
  const pid = gstatsValueForKey(decoded, 'pid') || '1';
  if (decoded.includes('\\authp\\') || decoded.startsWith('\\authp\\')) {
    return `\\pauthr\\${pid}\\lid\\${lid}`;
  }
  if (decoded.includes('\\getpid\\')) {
    return `\\getpidr\\${pid}\\lid\\${lid}`;
  }
  if (decoded.includes('\\getpd\\')) {
    return `\\getpdr\\1\\lid\\${lid}\\pid\\${pid}\\mod\\0\\length\\0\\data\\`;
  }
  if (decoded.includes('\\setpd\\')) {
    return `\\setpdr\\1\\lid\\${lid}\\pid\\${pid}\\mod\\0`;
  }
  return undefined;
}

export const CAREER_KEYS = [
  'rankNumber',
  'rankAllied',
  'rankAxis',
  'totalTeamBonusPoints',
  'totalNumKills',
  'totalPlayTime_Ranked',
  'totalAlliedMostAccurate',
  'totalAlliedMostLethal',
  'totalAlliedMostValuable',
  'totalAlliedMostHelpful',
  'totalAxisMostAccurate',
  'totalAxisMostLethal',
  'totalAxisMostValuable',
  'totalAxisMostHelpful',
  'accuracy',
  'totalNumShots',
  'totalNumHits',
  'totalNumHeadShots',
  'totalNumTeammateKills',
  'totalNumDeaths',
  'totalNumFFDeaths',
  'totalNumCorpsmanRevivals',
  'totalNumCorpsmanHeals',
  'totalNumDemoChargesPlanted',
  'totalNumDemoChargesDetonated',
  'totalNumDemoChargeDefuseFailures',
  'totalNumDemoChargesDefused',
  'totalPlayTime_FFA',
  'totalPlayTime_TeamMatch',
  'totalPlayTime_Invader',
];

export interface CareerStats {
  kills: number;
  deaths: number;
  score: number;
  timePlayedSeconds: number;
  customStats: Record<string, unknown>;
}

export const EMPTY_CAREER: CareerStats = {
  kills: 0,
  deaths: 0,
  score: 0,
  timePlayedSeconds: 0,
  customStats: {},
};

export interface GstatsPersona {
  id?: string;
  personaId?: string | number;
  stats?: Partial<CareerStats>;
}

export interface GstatsApi {
  reportMatch(body: StatsReportBody): Promise<boolean>;
  getPersonaByName(name: string, gameSlug?: string): Promise<GstatsPersona | null>;
  getPersonaByGsProfileId?(gsProfileId: number, gameSlug?: string): Promise<GstatsPersona | null>;
  writePersist?(personaId: string, kv: number, data: Record<string, number>): Promise<boolean>;
}

export function careerValue(stats: CareerStats, key: string): string {
  const custom = stats.customStats || {};
  switch (key) {
    case 'totalNumKills':
      return String(stats.kills || 0);
    case 'totalNumDeaths':
      return String(stats.deaths || 0);
    case 'totalTeamBonusPoints':
      return String(stats.score || 0);
    case 'totalPlayTime_Ranked':
      return String(stats.timePlayedSeconds || 0);
    case 'rankNumber':
    case 'rankAllied':
    case 'rankAxis':
      return '0';
    default: {
      const raw = custom[key];
      const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
      return String(Number.isFinite(n) ? Math.trunc(n) : 0);
    }
  }
}

export function careerData(stats: CareerStats, keys: string[]): string {
  const list = keys.length > 0 ? keys : CAREER_KEYS;
  let data = '';
  for (const key of list) {
    data += `\\${key}\\${careerValue(stats, key)}`;
  }
  return data;
}

export function parsePersistKv(data: string): Record<string, number> {
  const parts = data.split('\\');
  let i = parts[0] === '' ? 1 : 0;
  const out: Record<string, number> = {};
  for (; i + 1 < parts.length; i += 2) {
    if (!parts[i] || !/^-?\d+$/.test(parts[i + 1])) continue;
    out[parts[i]] = Number(parts[i + 1]);
  }
  return out;
}

function careerFromPersona(persona: GstatsPersona | null): CareerStats {
  if (!persona?.stats) return EMPTY_CAREER;
  const stats = persona.stats;
  return {
    kills: Number(stats.kills || 0),
    deaths: Number(stats.deaths || 0),
    score: Number(stats.score || 0),
    timePlayedSeconds: Number(stats.timePlayedSeconds || 0),
    customStats: stats.customStats || {},
  };
}

function personaIdOf(persona: GstatsPersona | null): string | null {
  if (!persona) return null;
  const id = persona.id ?? persona.personaId;
  if (id == null || id === '') return null;
  return String(id);
}

function randomChallenge(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * GameSpy gstats / persist (TCP 29920).
 *
 * MOHPA's community login calls IsStatsConnected() after peerchat 001.
 * That is `sock != INVALID_SOCKET` for the gstats TCP handle at 0xcf3710.
 * Without a completed InitStats handshake the UI shows Connect Error even
 * though FESL, GPCM, and peerchat already succeeded.
 */
export class GsStatsServer {
  private server: net.Server | null = null;
  private connections = new Set<net.Socket>();

  constructor(private readonly api: GstatsApi | null = null) {}

  public start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', reject);
      this.server.listen(port, host, () => {
        console.log(`[GsStats] GameSpy gstats listening on ${host}:${port}`);
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
    socket.setKeepAlive(true, 1000);
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    const sesskey = (crypto.randomBytes(4).readUInt32BE(0) % 900000) + 100000;
    let buffer: Buffer = Buffer.alloc(0);
    const session = {
      sentSesskey: false,
      nicks: new Map<string, string>(),
      matches: new GstatsMatchBuffer(),
    };

    console.log(`[GsStats] Connection from ${remote}`);
    socket.write(buildGstatsChallenge(randomChallenge(32)));

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseGstatsBuffer(buffer);
      buffer = parsed.rest;
      if (parsed.frames.length === 0) {
        for (const raw of parsed.unrecognized) {
          console.log(`[GsStats] [${remote}] ${rawHexLine(raw)}`);
        }
      }
      for (const frame of parsed.frames) {
        void this.handleFrame(socket, remote, sesskey, session, frame.command).catch((err) => {
          console.error(`[GsStats] [${remote}] ${(err as Error).message}`);
        });
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[GsStats] Connection closed ${remote}`);
    });
    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  private async resolvePersona(
    pid: string,
    nicks: Map<string, string>
  ): Promise<{ id: string; stats: CareerStats } | null> {
    if (!this.api) return null;
    const nick = nicks.get(pid);
    let persona: GstatsPersona | null = null;
    if (nick) {
      persona = await this.api.getPersonaByName(nick, 'mohpa');
    }
    if (!persona && this.api.getPersonaByGsProfileId && /^\d+$/.test(pid)) {
      persona = await this.api.getPersonaByGsProfileId(Number(pid), 'mohpa');
    }
    const id = personaIdOf(persona);
    if (!id) return null;
    return { id, stats: careerFromPersona(persona) };
  }

  private async handleFrame(
    socket: net.Socket,
    remote: string,
    sesskey: number,
    session: { sentSesskey: boolean; nicks: Map<string, string>; matches: GstatsMatchBuffer },
    command: GstatsCommand
  ): Promise<void> {
    if (command.type === 'auth') {
      if (!session.sentSesskey) {
        session.sentSesskey = true;
        console.log(`[GsStats] [${remote}] SEND sesskey=${sesskey}`);
        socket.write(buildGstatsSesskey(sesskey));
      }
      return;
    }

    if (command.type === 'newgame') return;

    if (command.type === 'updgame') {
      const finalSnap = session.matches.takeFinal(command);
      if (!finalSnap || !this.api) return;
      try {
        const report = await buildStatsReport(
          finalSnap.connid,
          finalSnap.sesskey,
          finalSnap.gamedata,
          async (name) => {
            const persona = await this.api!.getPersonaByName(name, 'mohpa');
            return personaIdOf(persona);
          }
        );
        console.log(`[GsStats] [${remote}] reportMatch ${report.statsMatchKey}`);
        const ok = await this.api.reportMatch(report);
        if (!ok) console.error(`[GsStats] [${remote}] reportMatch failed ${report.statsMatchKey}`);
      } catch (err) {
        console.error(`[GsStats] [${remote}] reportMatch failed ${(err as Error).message}`);
      }
      return;
    }

    if (command.type === 'authp') {
      if (command.pid && command.nick) session.nicks.set(command.pid, command.nick);
      const reply = `\\pauthr\\${command.pid || '1'}\\lid\\${command.lid || '1'}`;
      socket.write(buildGstatsPersistReply(reply));
      return;
    }

    if (command.type === 'getpid') {
      const reply = `\\getpidr\\${command.pid || '1'}\\lid\\${command.lid || '1'}`;
      socket.write(buildGstatsPersistReply(reply));
      return;
    }

    if (command.type === 'getpd') {
      const lid = command.lid || '1';
      const pid = command.pid || '1';
      const keys = command.keys ? command.keys.split('\\').filter(Boolean) : [];
      const resolved = await this.resolvePersona(pid, session.nicks);
      const data = careerData(resolved?.stats || EMPTY_CAREER, keys);
      const unix = Math.floor(Date.now() / 1000);
      const reply = `\\getpdr\\1\\lid\\${lid}\\pid\\${pid}\\mod\\${unix}\\length\\${Buffer.byteLength(data, 'latin1')}\\data\\${data}`;
      socket.write(buildGstatsPersistReply(reply));
      return;
    }

    if (command.type === 'setpd') {
      const lid = command.lid || '1';
      const pid = command.pid || '1';
      const resolved = await this.resolvePersona(pid, session.nicks);
      if (resolved && this.api?.writePersist) {
        await this.api.writePersist(resolved.id, Number(command.kv || 0), parsePersistKv(command.data));
      }
      const unix = Math.floor(Date.now() / 1000);
      const reply = `\\setpdr\\1\\lid\\${lid}\\pid\\${pid}\\mod\\${unix}`;
      socket.write(buildGstatsPersistReply(reply));
    }
  }
}
