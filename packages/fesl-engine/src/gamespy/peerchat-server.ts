import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { getGsPreauth, toGsNumericId } from './ticket-store.js';

const MOHPA_GAMEKEY = 'S6v8Lm';

interface CryptKey {
  state: Uint8Array;
  x: number;
  y: number;
}

function xcode(buf: Buffer, key: string): Buffer {
  const out = Buffer.from(buf);
  let pos = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] ^= key.charCodeAt(pos);
    pos += 1;
    if (pos >= key.length) pos = 0;
  }
  return out;
}

function prepareKey(keyData: Buffer): CryptKey {
  const state = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    state[255 - i] = i;
  }
  let index1 = 0;
  let index2 = 0;
  for (let counter = 0; counter < 256; counter++) {
    index2 = (keyData[index1] + state[counter] + index2) & 0xff;
    const tmp = state[counter];
    state[counter] = state[index2];
    state[index2] = tmp;
    index1 = (index1 + 1) % keyData.length;
  }
  return { state, x: 0, y: 0 };
}

function gsCrypt(buffer: Buffer, key: CryptKey): Buffer {
  const out = Buffer.from(buffer);
  let { x, y } = key;
  const state = key.state;
  for (let i = 0; i < out.length; i++) {
    x = (x + 1) & 0xff;
    y = (state[x] + y) & 0xff;
    const tmp = state[x];
    state[x] = state[y];
    state[y] = tmp;
    const xorIndex = (state[x] + state[y]) & 0xff;
    out[i] ^= state[xorIndex];
  }
  key.x = x;
  key.y = y;
  return out;
}

function randomKey(len = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function sendWelcome(sendPlain: (line: string) => void, nick: string): void {
  // 2004 ciRplWelcomeHandler requires numParams == 2. Keep the trailing
  // welcome as one colon-param; extra words are fine because ciParseParam
  // treats " :" as the last param, but a short welcome is the safe shape.
  sendPlain(`:s 001 ${nick} :Welcome`);
  sendPlain(`:s 002 ${nick} :YourHost`);
  sendPlain(`:s 003 ${nick} :Created`);
  sendPlain(`:s 004 ${nick} s 1.0 io`);
  sendPlain(`:s 375 ${nick} :-MOTD`);
  sendPlain(`:s 372 ${nick} :-Online`);
  sendPlain(`:s 376 ${nick} :EndMOTD`);
}

/**
 * Minimal GameSpy peerchat (TCP 6667) for MOHPA chatConnect / preauth.
 * Implements CRYPT 705, USRIP, LOGIN 707, and IRC welcome numerics.
 */
export class PeerchatServer {
  private server: net.Server | null = null;
  private connections = new Set<net.Socket>();

  public start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', reject);
      this.server.listen(port, host, () => {
        console.log(`[Peerchat] GameSpy peerchat listening on ${host}:${port}`);
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
    console.log(`[Peerchat] Connection from ${remote}`);

    let encrypted = false;
    let inKey: CryptKey | null = null;
    let outKey: CryptKey | null = null;
    let nick = 'Player';
    let gotUser = false;
    let gotNick = false;
    let welcomed = false;
    let buffer = Buffer.alloc(0);

    const sendPlain = (line: string) => {
      console.log(`[Peerchat] [${remote}] >> ${line}`);
      const payload = Buffer.from(`${line}\r\n`, 'ascii');
      const wire = encrypted && outKey ? gsCrypt(payload, outKey) : payload;
      socket.write(wire);
    };

    const ipv4 = () => {
      const raw = socket.remoteAddress || '0.0.0.0';
      return raw.replace(/^::ffff:/, '');
    };

    socket.on('data', (chunk) => {
      const decoded = encrypted && inKey ? gsCrypt(Buffer.from(chunk), inKey) : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, decoded]);
      while (true) {
        const idx = buffer.indexOf(0x0a);
        if (idx < 0) break;
        let line = buffer.subarray(0, idx).toString('latin1');
        buffer = buffer.subarray(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line) continue;
        const printable = /^[\x20-\x7e]+$/.test(line);
        console.log(`[Peerchat] [${remote}] << ${printable ? line : `hex=${Buffer.from(line, 'latin1').toString('hex')}`}`);
        const upper = line.toUpperCase();
        const parts = line.split(/\s+/);

        if (upper.startsWith('CRYPT')) {
          const clientKey = randomKey();
          const serverKey = randomKey();
          sendPlain(`:s 705 * ${clientKey} ${serverKey}`);
          const clientPrepared = xcode(Buffer.from(clientKey, 'ascii'), MOHPA_GAMEKEY);
          const serverPrepared = xcode(Buffer.from(serverKey, 'ascii'), MOHPA_GAMEKEY);
          // 705 params[1] = client outKey, params[2] = client inKey.
          inKey = prepareKey(clientPrepared);
          outKey = prepareKey(serverPrepared);
          encrypted = true;
          continue;
        }
        if (upper.startsWith('USRIP')) {
          // ciRplUserIPHandler takes the last IRC param and looks for '@'.
          // A nick in the middle makes that the only parsed param, so the IP
          // must be the trailing colon-param: ":s 302 :=+@1.2.3.4"
          sendPlain(`:s 302 :=+@${ipv4()}`);
          continue;
        }
        if (upper.startsWith('NICK')) {
          nick = (parts[1] || nick).replace(/^:/, '') || nick;
          gotNick = true;
          if (gotUser && !welcomed) {
            welcomed = true;
            sendWelcome(sendPlain, nick);
          }
          continue;
        }
        if (upper.startsWith('USER')) {
          gotUser = true;
          if (gotNick && !welcomed) {
            welcomed = true;
            sendWelcome(sendPlain, nick);
          }
          continue;
        }
        if (upper.startsWith('JOIN')) {
          const channel = (parts[1] || '').replace(/^:/, '') || '#GSP!mohpa';
          sendPlain(`:${nick} JOIN ${channel}`);
          sendPlain(`:s 332 ${nick} ${channel} :mohPA`);
          sendPlain(`:s 353 ${nick} = ${channel} :${nick}`);
          sendPlain(`:s 366 ${nick} ${channel} :End of NAMES`);
          continue;
        }
        if (upper.startsWith('GETCKEY') || upper.startsWith('GETCHANKEY')) {
          const cookie = parts[parts.length - 1] || '0';
          sendPlain(`:s 703 ${nick} ${cookie} :End of GETCKEY`);
          continue;
        }
        if (upper.startsWith('LOGINPREAUTH') || upper.startsWith('LOGIN')) {
          const token = parts[1] || '';
          const preauth = token ? getGsPreauth(token) : undefined;
          if (preauth?.username) {
            nick = preauth.username;
          }
          const userId = toGsNumericId(preauth?.userId || nick);
          sendPlain(`:s 707 ${nick} ${userId} ${userId}`);
          continue;
        }
        if (upper.startsWith('PING')) {
          sendPlain(`PONG ${parts[1] || ':s'}`);
          continue;
        }
        if (upper.startsWith('QUIT')) {
          socket.end();
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[Peerchat] Connection closed ${remote}`);
    });
    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }
}
