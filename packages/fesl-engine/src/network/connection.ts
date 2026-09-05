import * as net from 'node:net';
import * as tls from 'node:tls';
import { FeslPacket, FeslSessionData, ClientType, encodePacket, serializeKV } from '@centralspy/shared';
import { InspectorHub } from '../inspector/inspector-hub.js';

export interface ConnectionOptions {
  id: string;
  socket: net.Socket | tls.TLSSocket;
  serverPort: number;
  isTls: boolean;
}

export class FeslConnection {
  public readonly id: string;
  public readonly socket: net.Socket | tls.TLSSocket;
  public readonly serverPort: number;
  public readonly isTls: boolean;
  public readonly remoteAddress: string;
  public readonly remotePort: number;
  public readonly connectedAt: number;

  public lastActivityAt: number;
  public buffer: Buffer = Buffer.alloc(0);
  public session: FeslSessionData | null = null;
  public clientType: ClientType = 'client';
  public sku?: string;
  public locale?: string;
  public gameSlug?: string;
  public domainPartition?: string;
  public customData = new Map<string, any>();
  private isClosed = false;

  constructor(options: ConnectionOptions) {
    this.id = options.id;
    this.socket = options.socket;
    this.serverPort = options.serverPort;
    this.isTls = options.isTls;
    this.remoteAddress = options.socket.remoteAddress || '127.0.0.1';
    this.remotePort = options.socket.remotePort || 0;
    this.connectedAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  public get lkey(): string | undefined {
    return this.session?.lkey;
  }

  public touch(): void {
    this.lastActivityAt = Date.now();
  }

  public attachSession(session: FeslSessionData): void {
    this.session = session;
    if (session.clientType) {
      this.clientType = session.clientType;
    }
    if (session.gameSlug) {
      this.gameSlug = session.gameSlug;
    }
  }

  /**
   * Sends a FESL packet to the client over TCP/TLS.
   */
  public sendPacket(packet: FeslPacket | { subsystem: string; subtype: number; payload: Record<string, any> | string; packetLength?: number; rawPayload?: string }): void {
    if (this.isClosed || this.socket.destroyed) return;

    const subsystem = (packet.subsystem || 'fsys').padEnd(4, ' ').substring(0, 4);
    const subtype = packet.subtype >>> 0;
    const payload = packet.payload;

    const encoded = encodePacket(subsystem, subtype, payload);

    try {
      this.socket.write(encoded);
      this.touch();

      const payloadObj = typeof payload === 'string' ? { raw: payload } : payload;
      const rawString = typeof payload === 'string' ? payload : serializeKV(payload);
      const txn = (payloadObj as any).TXN || (payloadObj as any).txn;

      console.log(`[TcpServer] [${this.id}] SEND ${subsystem} (0x${subtype.toString(16)}) TXN=${txn || 'none'} (${encoded.length} bytes)`);

      // Broadcast to WebSocket inspector
      InspectorHub.getInstance().broadcastPacket({
        id: `out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now(),
        direction: 'out',
        subsystem,
        packetType: subtype,
        packetTypeHex: `0x${subtype.toString(16).padStart(8, '0')}`,
        length: encoded.length,
        txn,
        connectionId: this.id,
        remoteAddress: this.remoteAddress,
        remotePort: this.remotePort,
        clientType: this.clientType,
        lkey: this.session?.lkey,
        username: this.session?.username,
        personaName: this.session?.personaName,
        payload: payloadObj,
        rawPayload: rawString,
      });
    } catch (err) {
      console.warn(`[Connection ${this.id}] Error writing packet: ${(err as Error).message}`);
    }
  }

  /**
   * Sends an error container response packet.
   */
  public sendError(
    subsystem: string,
    requestSubtype: number,
    txn: string,
    errorDetails: Array<{ fieldName: string; fieldError: string | number; fieldErrorCode?: number | string }> | string
  ): void {
    const errorContainer = typeof errorDetails === 'string'
      ? [{ fieldName: 'error', fieldError: errorDetails }]
      : errorDetails;

    const payload: Record<string, any> = {
      TXN: txn,
      errorContainer,
    };

    const responseSubtype = (requestSubtype | 0x80000000) >>> 0;
    this.sendPacket({
      subsystem,
      subtype: responseSubtype,
      payload,
    });
  }

  /**
   * Closes the underlying socket gracefully.
   */
  public close(reason?: string): void {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      if (!this.socket.destroyed) {
        this.socket.end();
      }
    } catch {}

    this.buffer = Buffer.alloc(0);
  }
}
