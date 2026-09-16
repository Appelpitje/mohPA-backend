import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { gpClientResponse, gpServerProof } from './gp-proof.js';
import { getGsPreauth, toGsNumericId } from './ticket-store.js';

const FINAL = '\\final\\';

function parseGsPacket(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = raw.split('\\');
  for (let i = 1; i + 1 < parts.length; i += 2) {
    out[parts[i]] = parts[i + 1];
  }
  return out;
}

function encodeGs(fields: Record<string, string | number>): string {
  let body = '';
  for (const [key, value] of Object.entries(fields)) {
    body += `\\${key}\\${value}`;
  }
  // 2004 GP SDK splits on \final\ and then strncmp's the next message
  // against "\\lc\\2". A trailing \r\n is left in the input buffer and
  // poisons that check, so do not append one.
  return `${body}${FINAL}`;
}

function randomChallenge(length = 32): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * Minimal GameSpy Presence (GPCM) server for MOHPA partner/preauth login.
 * Listens on TCP 29900 and accepts authtokens issued by acct.GameSpyPreAuth.
 */
export class GpcmServer {
  private server: net.Server | null = null;
  private connections = new Set<net.Socket>();

  public start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', reject);
      this.server.listen(port, host, () => {
        console.log(`[GpcmServer] GameSpy GPCM listening on ${host}:${port}`);
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
    const serverChallenge = randomChallenge(32);
    let buffer = '';

    const hello = encodeGs({ lc: 1, challenge: serverChallenge, id: 1 });
    console.log(`[GpcmServer] Connection from ${remote} challenge=${serverChallenge}`);
    console.log(`[GpcmServer] [${remote}] SEND lc1 hex=${Buffer.from(hello, 'ascii').toString('hex')}`);
    socket.write(hello, 'ascii');

    socket.on('data', (chunk) => {
      console.log(`[GpcmServer] [${remote}] RAW ${chunk.length}b hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('latin1'))}`);
      buffer += chunk.toString('latin1');
      let idx: number;
      while ((idx = buffer.indexOf(FINAL)) !== -1) {
        const packet = buffer.slice(0, idx);
        buffer = buffer.slice(idx + FINAL.length);
        this.handlePacket(socket, packet, serverChallenge, remote);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[GpcmServer] Connection closed ${remote}`);
    });
    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  private handlePacket(socket: net.Socket, raw: string, serverChallenge: string, remote: string): void {
    const fields = parseGsPacket(raw);
    const keys = Object.keys(fields);
    console.log(`[GpcmServer] [${remote}] RECV`, keys.join(','), JSON.stringify(fields));

    if ('login' in fields) {
      this.handleLogin(socket, fields, serverChallenge, remote);
      return;
    }
    if ('ka' in fields) {
      socket.write(encodeGs({ ka: '' }), 'ascii');
      return;
    }
    if ('status' in fields) {
      return;
    }
    if ('getprofile' in fields) {
      const profileId = fields.profileid || '1';
      const nick = fields.nick || 'Player';
      socket.write(encodeGs({
        pi: '',
        profileid: profileId,
        nick,
        uniquenick: nick,
        userid: profileId,
        email: `${nick}@mohpa.local`,
        sig: crypto.randomBytes(16).toString('hex'),
        id: fields.id || '2',
      }), 'ascii');
      return;
    }
    if ('logout' in fields) {
      socket.end();
    }
  }

  private handleLogin(
    socket: net.Socket,
    fields: Record<string, string>,
    serverChallenge: string,
    remote: string
  ): void {
    const authtoken = fields.authtoken || '';
    const clientChallenge = fields.challenge || '';
    const clientResponse = fields.response || '';
    const preauth = authtoken ? getGsPreauth(authtoken) : undefined;

    if (!preauth || !preauth.username) {
      console.warn(`[GpcmServer] [${remote}] Invalid, missing or unauthenticated authtoken=${authtoken} — rejecting login`);
      socket.write(encodeGs({
        error: '',
        err: 260,
        errmsg: 'Invalid login or session expired',
        id: fields.id || '1',
        fatal: '',
      }), 'ascii');
      socket.end();
      return;
    }

    const partnerChallenge = preauth.challenge || clientChallenge;
    const nick = preauth.username;
    const userId = toGsNumericId(preauth.userId || nick);
    const lkey = preauth.lkey || crypto.randomBytes(12).toString('hex');

    const user = authtoken || nick;
    const expected = gpClientResponse(partnerChallenge, user, clientChallenge, serverChallenge);
    if (clientResponse && clientResponse !== expected) {
      console.warn(`[GpcmServer] [${remote}] Proof mismatch expected=${expected} got=${clientResponse}`);
    }

    const proof = gpServerProof(partnerChallenge, user, clientChallenge, serverChallenge);
    const sesskey = (Date.now() % 1000000000) + Math.floor(Math.random() * 1000);

    const reply = encodeGs({
      lc: 2,
      sesskey,
      proof,
      userid: userId,
      profileid: userId,
      uniquenick: nick,
      lt: `${lkey}__`,
      id: fields.id || '1',
    });
    console.log(`[GpcmServer] [${remote}] SEND login ok nick=${nick} userid=${userId}`);
    socket.write(reply, 'ascii');
    socket.write(encodeGs({ bdy: 0, list: '' }), 'ascii');
  }
}
