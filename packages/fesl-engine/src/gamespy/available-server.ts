import * as dgram from 'node:dgram';
import { parseGsKeyValues, parseQr2KeyValues } from './compact-list.js';
import { GameServerRegistry } from './server-registry.js';

/**
 * GameSpy GSI availability (gsAvailable.c, 2004) plus QR1/QR2 heartbeats
 * on the same UDP 27900 socket (OpenSpy QR service).
 *
 * MOHPA queries UDP 27900 on `<gamename>.available.fesl.ea.com` with a
 * datagram whose first byte is 0x09. The client then requires at least 7
 * bytes back whose first three bytes are 0xFE 0xFD 0x09. Bytes 3-6 are a
 * big-endian status dword: bit0 set = unavailable, bit1 set = temp
 * unavailable, both clear = available.
 */
export const GS_AVAILABLE_MAGIC = Buffer.from([0xfe, 0xfd, 0x09]);
export const GS_AVAILABLE_OK = Buffer.from([0xfe, 0xfd, 0x09, 0x00, 0x00, 0x00, 0x00]);
const QR1_SECURE = Buffer.from('\\basic\\\\secure\\ABCDEF', 'ascii');

export function buildAvailableReply(_request: Buffer): Buffer {
  return Buffer.from(GS_AVAILABLE_OK);
}

export function handleGsUdpMessage(
  msg: Buffer,
  rinfo: { address: string; port: number },
  registry: GameServerRegistry
): Buffer | null {
  if (msg.length === 0) return null;
  const first = msg[0];

  if (first === 0x09) {
    return buildAvailableReply(msg);
  }

  if (first === 0x03 && msg.length >= 5) {
    const kv = parseQr2KeyValues(msg.subarray(5));
    const port = parseInt(kv.localport || String(rinfo.port), 10);
    const gamename = kv.gamename || 'mohpa';
    if (kv.statechanged === '2') {
      registry.remove(rinfo.address, port, gamename);
      return null;
    }
    registry.upsert({ ip: rinfo.address, port, gamename });
    return Buffer.concat([Buffer.from([0xfe, 0xfd, 0x08]), msg.subarray(1, 5)]);
  }

  const text = msg.toString('latin1');
  if (text.includes('\\heartbeat\\')) {
    const kv = parseGsKeyValues(text);
    const port = parseInt(kv.heartbeat || kv.port || String(rinfo.port), 10);
    const gamename = kv.gamename || 'mohpa';
    registry.upsert({ ip: rinfo.address, port, gamename });
    return QR1_SECURE;
  }

  if (text.includes('\\validate\\')) {
    return null;
  }

  if (text.includes('\\list\\')) {
    const kv = parseGsKeyValues(text);
    return registry.encodeList(kv.gamename || 'mohpa');
  }

  if (msg.length <= 16 && msg.includes(Buffer.from('mohpa'))) {
    return buildAvailableReply(msg);
  }

  return null;
}

export class GsAvailableServer {
  private socket: dgram.Socket | null = null;
  private registry: GameServerRegistry;

  constructor(registry?: GameServerRegistry) {
    this.registry = registry ?? new GameServerRegistry();
  }

  public start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      this.socket = socket;
      socket.on('error', reject);
      socket.on('message', (msg, rinfo) => {
        const reply = handleGsUdpMessage(msg, rinfo, this.registry);
        console.log(
          `[GsAvailable] ${rinfo.address}:${rinfo.port} type=0x${msg[0].toString(16)} ${msg.length}b hex=${msg.subarray(0, 24).toString('hex')}${reply ? ` reply=${reply.length}b` : ''}`
        );
        if (!reply) return;
        socket.send(reply, rinfo.port, rinfo.address, (err) => {
          if (err) {
            console.warn(`[GsAvailable] send failed: ${err.message}`);
          }
        });
      });
      socket.bind(port, host, () => {
        console.log(`[GsAvailable] GameSpy availability UDP listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}
