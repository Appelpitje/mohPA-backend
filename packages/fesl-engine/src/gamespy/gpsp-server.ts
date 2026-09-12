import * as net from 'node:net';
import * as crypto from 'node:crypto';

const FINAL = '\\final\\';

function encodeGs(fields: Record<string, string | number>): string {
  let body = '';
  for (const [key, value] of Object.entries(fields)) {
    body += `\\${key}\\${value}`;
  }
  return `${body}${FINAL}`;
}

function randomChallenge(length = 32): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * GameSpy search manager (GPSP, TCP 29901).
 *
 * After GPCM login the 2004 client may connect here for buddy/profile
 * search. A missing listener is fine on Wine (fast RST) but Windows
 * should get an immediate \\lc\\1 + \\bsrdone\\ so the UI thread
 * is not left waiting.
 */
export class GsPspServer {
  private server: net.Server | null = null;
  private connections = new Set<net.Socket>();

  public start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', reject);
      this.server.listen(port, host, () => {
        console.log(`[GsPsp] GameSpy GPSP listening on ${host}:${port}`);
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
    const hello = encodeGs({ lc: 1, challenge: randomChallenge(32), id: 1 });
    console.log(`[GsPsp] Connection from ${remote}`);
    socket.write(hello, 'ascii');

    let buffer = '';
    socket.on('data', (chunk) => {
      const text = chunk.toString('latin1');
      console.log(`[GsPsp] [${remote}] << ${JSON.stringify(text.slice(0, 180))}`);
      buffer += text;
      let idx: number;
      while ((idx = buffer.indexOf(FINAL)) !== -1) {
        buffer = buffer.slice(idx + FINAL.length);
        const done = encodeGs({ bsrdone: '' });
        socket.write(done, 'ascii');
      }
    });
    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[GsPsp] Connection closed ${remote}`);
    });
    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }
}
