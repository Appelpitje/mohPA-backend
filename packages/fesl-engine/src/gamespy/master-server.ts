import * as net from 'node:net';
import { wrapEnctype2, MOHPA_SECKEY } from './enctype2.js';
import { parseGsKeyValues } from './compact-list.js';
import { GameServerRegistry } from './server-registry.js';

const GREETING = Buffer.from('\\basic\\\\secure\\ABCDEF', 'ascii');

/**
 * GameSpy GOA master (TCP 28900 / 27900).
 *
 * MOHPA ServerListUpdate connect()s here. A dropped SYN freezes Windows ~20s.
 * 2004 listxfer with encryptdata=1 treats the first reply byte as keylen^0xEC;
 * a plaintext `\final\` (`\` = 0x5C) becomes key length 176 and the client
 * waits for a 177-byte header — UI not-responding until that times out.
 *
 * Speak `\basic\\secure\` first, then wait for the client. `\list\` is a
 * compact IPv4:port dump plus `\final\`. `\enctype\2\` wraps that dump.
 */
export class GsMasterServer {
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
        console.log(`[GsMaster] GameSpy master listening on ${host}:${port}`);
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
    console.log(`[GsMaster] Connection from ${remote}`);
    socket.write(GREETING);

    let sentList = false;
    let enctype2 = false;
    let gamename = 'mohpa';
    const finish = (useEnctype2: boolean, name: string) => {
      if (sentList || socket.destroyed) return;
      sentList = true;
      const plaintext = this.registry.encodeList(name);
      const body = useEnctype2 ? wrapEnctype2(plaintext, MOHPA_SECKEY, Buffer.from(MOHPA_SECKEY, 'ascii')) : plaintext;
      console.log(
        `[GsMaster] [${remote}] >> ${useEnctype2 ? 'enctype2' : 'plain'} ${plaintext.length}b/${body.length}b servers=${this.registry.list(name).length} hex=${body.subarray(0, 24).toString('hex')}`
      );
      socket.write(body);
    };

    socket.on('data', (chunk) => {
      const text = chunk.toString('latin1');
      console.log(
        `[GsMaster] [${remote}] << ${JSON.stringify(text.slice(0, 200))} hex=${chunk.subarray(0, 24).toString('hex')}`
      );
      const kv = parseGsKeyValues(text);
      if (kv.gamename) {
        gamename = kv.gamename;
      }
      if (text.includes('\\enctype\\2')) {
        enctype2 = true;
      }
      if (text.includes('\\list\\') || text.includes('\\final\\')) {
        finish(enctype2, gamename);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[GsMaster] Connection closed ${remote}`);
    });
    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }
}
