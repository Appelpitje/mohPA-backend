import * as net from 'node:net';
import * as crypto from 'node:crypto';

/** XOR key used by gstats.c xcode_buf (enc1 = "GameSpy3D"). */
export const GSTATS_XOR_KEY = Buffer.from('GameSpy3D', 'ascii');

const FINAL = '\\final\\';

export function gstatsXcode(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  let pos = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] ^= GSTATS_XOR_KEY[pos];
    pos += 1;
    if (pos >= GSTATS_XOR_KEY.length) pos = 0;
  }
  return out;
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
    const challenge = randomChallenge(32);
    const sesskey = (crypto.randomBytes(4).readUInt32BE(0) % 900000) + 100000;
    let buffer = Buffer.alloc(0);
    let sentSesskey = false;

    const wire = buildGstatsChallenge(challenge);
    console.log(`[GsStats] Connection from ${remote} challenge=${challenge}`);
    socket.write(wire);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      console.log(`[GsStats] [${remote}] RAW ${chunk.length}b`);
      const finalBuf = Buffer.from(FINAL, 'ascii');
      while (true) {
        const finalIdx = buffer.indexOf(finalBuf);
        const payload = finalIdx >= 0 ? buffer.subarray(0, finalIdx) : buffer;
        if (finalIdx < 0 && payload.length < 8) break;
        const decoded = gstatsXcode(payload).toString('latin1');
        console.log(`[GsStats] [${remote}] decoded ${decoded.length}b`);
        if (!sentSesskey && (decoded.includes('\\auth\\') || decoded.includes('\\gamename\\'))) {
          sentSesskey = true;
          const reply = buildGstatsSesskey(sesskey);
          console.log(`[GsStats] [${remote}] SEND sesskey=${sesskey}`);
          socket.write(reply);
        } else {
          const persist = gstatsPersistReplyFor(decoded);
          if (persist) {
            console.log(`[GsStats] [${remote}] SEND persist ${persist}`);
            socket.write(buildGstatsPersistReply(persist));
          }
        }
        if (finalIdx < 0) break;
        buffer = buffer.subarray(finalIdx + finalBuf.length);
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
}
