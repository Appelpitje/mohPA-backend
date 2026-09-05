import * as net from 'node:net';
import * as tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { decodePacket, FeslPacket, HEADER_SIZE } from '@centralspy/shared';
import { FeslConnection } from './connection.js';
import { TlsManager } from './tls-manager.js';
import { Ssl2Socket } from './ssl2-socket.js';
import { InspectorHub } from '../inspector/inspector-hub.js';
import { config } from '../config/config.js';

export interface PortListenerConfig {
  port: number;
  isTls: boolean;
  name: string;
}

export interface TcpServerEvents {
  packet: (connection: FeslConnection, packet: FeslPacket) => void;
  connection: (connection: FeslConnection) => void;
  disconnect: (connection: FeslConnection, reason?: string) => void;
  error: (error: Error, connection?: FeslConnection) => void;
}

export class TcpServer extends EventEmitter {
  private servers: Map<number, net.Server | tls.Server> = new Map();
  private connections: Map<string, FeslConnection> = new Map();
  private tlsManager: TlsManager;
  private connectionSeq = 0;
  private activityCheckInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(tlsManager: TlsManager = TlsManager.getInstance()) {
    super();
    this.tlsManager = tlsManager;
  }

  /**
   * Starts multi-port listeners according to configuration.
   */
  public async start(portConfigs?: PortListenerConfig[]): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Ensure both MOHPA (18020) and BF2/later (18270) client ports are always active
    const clientPorts = new Set<number>([18020, 18270]);
    if (config.feslClientPort) {
      clientPorts.add(config.feslClientPort);
    }

    const defaultConfigs: PortListenerConfig[] = portConfigs || [
      ...Array.from(clientPorts).map((p) => ({
        port: p,
        isTls: true,
        name: p === 18020 ? 'FESL Client MOHPA (TLS 18020)' : `FESL Client (TLS ${p})`,
      })),
      { port: config.feslServerPort, isTls: true, name: 'FESL Server (TLS)' },
      { port: config.theaterClientPort, isTls: false, name: 'Theater Client (TCP)' },
      { port: config.theaterServerPort, isTls: false, name: 'Theater Server (TCP)' },
    ];

    for (const pConfig of defaultConfigs) {
      await this.listenPort(pConfig);
    }

    // Start heartbeat / inactivity monitor
    this.startActivityMonitor();
  }

  /**
   * Binds a single TCP or TLS listener on the specified port.
   */
  public listenPort(pConfig: PortListenerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      let server: net.Server | tls.Server;

      if (pConfig.isTls) {
        if (pConfig.port === 18020 || pConfig.name.includes('MOHPA')) {
          // Dedicated SSL 2.0 listener for Medal of Honor: Pacific Assault (2004 DirtySDK)
          server = net.createServer((rawSocket: net.Socket) => {
            console.log(`[TcpServer] Incoming TCP connection from ${rawSocket.remoteAddress}:${rawSocket.remotePort} on port ${pConfig.port} (${pConfig.name})`);

            rawSocket.once('data', (firstChunk: Buffer) => {
              if (firstChunk.length === 0) return;

              // SSL 2.0: 2-byte header with MSB set, msgType 1 (CLIENT_HELLO)
              const isSsl2 = (firstChunk[0] & 0x80) !== 0 && firstChunk.length >= 3 && firstChunk[2] === 0x01;

              if (isSsl2) {
                console.log(`[TcpServer] Detected SSL 2.0 ClientHello on port ${pConfig.port} from ${rawSocket.remoteAddress}:${rawSocket.remotePort}`);
                const certDer = this.tlsManager.getDerCertificate();
                const certs = this.tlsManager.getCertificates();
                const ssl2Socket = new Ssl2Socket({
                  rawSocket,
                  certDer,
                  privateKeyPem: certs.key,
                  initialChunk: firstChunk,
                });

                ssl2Socket.once('secureConnect', () => {
                  this.handleNewConnection(ssl2Socket as any, pConfig.port, true);
                });
              } else {
                console.log(`[TcpServer] Non-SSL2 data detected on port ${pConfig.port} from ${rawSocket.remoteAddress}:${rawSocket.remotePort}, treating as plain TCP`);
                rawSocket.unshift(firstChunk);
                this.handleNewConnection(rawSocket, pConfig.port, false);
              }
            });
          });
        } else {
          // Standard modern TLS listener (Battlefield 2, 2142, and other FESL clients)
          const tlsOptions = this.tlsManager.getTlsOptions();
          server = tls.createServer(tlsOptions, (socket: tls.TLSSocket) => {
            this.handleNewConnection(socket, pConfig.port, true);
          });
          server.on('tlsClientError', (err: Error, socket: net.Socket) => {
            console.error(`[TcpServer] TLS Client Error on port ${pConfig.port} from ${socket.remoteAddress}:${socket.remotePort}: ${err.message}`);
          });
        }
      } else {
        server = net.createServer((socket: net.Socket) => {
          this.handleNewConnection(socket, pConfig.port, false);
        });
      }

      server.on('connection', (rawSocket: net.Socket) => {
        if (!pConfig.isTls || (!pConfig.name.includes('MOHPA') && pConfig.port !== 18020)) {
          console.log(`[TcpServer] Incoming TCP connection from ${rawSocket.remoteAddress}:${rawSocket.remotePort} on port ${pConfig.port} (${pConfig.name})`);
        }
      });

      server.on('error', (err: Error) => {
        console.error(`[TcpServer] Error on port ${pConfig.port} (${pConfig.name}): ${err.message}`);
        this.emit('error', err);
      });

      server.listen(pConfig.port, config.host, () => {
        console.log(`[TcpServer] ${pConfig.name} listening on ${config.host}:${pConfig.port} [${pConfig.isTls ? 'TLS' : 'PLAIN TCP'}]`);
        this.servers.set(pConfig.port, server);
        resolve();
      });
    });
  }

  /**
   * Handles a newly established socket connection and attaches packet reassembly framing.
   */
  private handleNewConnection(
    socket: net.Socket | tls.TLSSocket,
    serverPort: number,
    isTls: boolean
  ): void {
    const connId = `conn_${++this.connectionSeq}_${serverPort}_${socket.remotePort || 0}`;
    const connection = new FeslConnection({
      id: connId,
      socket,
      serverPort,
      isTls,
    });

    console.log(`[TcpServer] Established ${isTls ? 'TLS' : 'TCP'} connection ${connId} on port ${serverPort} from ${connection.remoteAddress}:${connection.remotePort}`);

    this.connections.set(connId, connection);

    // Disable Nagle's algorithm for low-latency gaming packet exchange
    socket.setNoDelay(true);
    // Enable TCP Keep-Alive
    socket.setKeepAlive(true, 30000);

    // Notify inspector
    InspectorHub.getInstance().broadcastConnection({
      connectionId: connId,
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      serverPort,
      isTls,
      timestamp: Date.now(),
      type: 'connected',
    });

    this.emit('connection', connection);

    // Stream buffer framing and packet reassembly
    socket.on('data', (chunk: Buffer) => {
      connection.touch();
      this.processIncomingChunk(connection, chunk);
    });

    socket.on('close', (hadError: boolean) => {
      this.handleConnectionClose(connection, hadError ? 'Socket closed with error' : 'Socket closed');
    });

    socket.on('error', (err: Error) => {
      const ignoreCodes = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];
      if (!ignoreCodes.includes((err as any).code)) {
        console.warn(`[TcpServer] Connection ${connId} error: ${err.message}`);
      }
      this.handleConnectionClose(connection, err.message);
    });

    socket.on('timeout', () => {
      this.handleConnectionClose(connection, 'Socket idle timeout');
    });
  }

  /**
   * Accumulates chunks in the connection buffer and slices out complete FESL packets.
   */
  private processIncomingChunk(connection: FeslConnection, chunk: Buffer): void {
    connection.buffer = connection.buffer.length === 0
      ? chunk
      : Buffer.concat([connection.buffer, chunk]);

    // Parse all complete packets available in the buffer
    while (connection.buffer.length >= HEADER_SIZE) {
      const packetLength = connection.buffer.readUInt32BE(8);

      // Packet length sanity check
      if (packetLength < HEADER_SIZE || packetLength > 10 * 1024 * 1024) {
        console.warn(`[TcpServer] Invalid packet length ${packetLength} from connection ${connection.id}. Resetting buffer.`);
        connection.buffer = Buffer.alloc(0);
        connection.close('Invalid packet header length');
        break;
      }

      // If buffer contains fewer bytes than the complete packet, wait for subsequent chunks
      if (connection.buffer.length < packetLength) {
        break;
      }

      // Slice out the complete packet bytes
      const packetBuffer = connection.buffer.subarray(0, packetLength);
      connection.buffer = connection.buffer.subarray(packetLength);

      try {
        const decoded = decodePacket(packetBuffer);
        if (decoded) {
          const packet: FeslPacket = {
            subsystem: decoded.header.subsystem,
            subtype: decoded.header.subtype,
            packetLength: decoded.header.packetLength,
            payload: decoded.payload,
            rawPayload: decoded.payloadString,
          };

          const txn = packet.payload.TXN || packet.payload.txn;

          console.log(`[TcpServer] [${connection.id}] RECV ${packet.subsystem} (0x${packet.subtype.toString(16)}) TXN=${txn || 'none'} (${packet.packetLength} bytes)`);

          // Broadcast to WebSocket inspector
          InspectorHub.getInstance().broadcastPacket({
            id: `in_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            timestamp: Date.now(),
            direction: 'in',
            subsystem: packet.subsystem,
            packetType: packet.subtype,
            packetTypeHex: `0x${packet.subtype.toString(16).padStart(8, '0')}`,
            length: packet.packetLength,
            txn,
            connectionId: connection.id,
            remoteAddress: connection.remoteAddress,
            remotePort: connection.remotePort,
            clientType: connection.clientType,
            lkey: connection.session?.lkey,
            username: connection.session?.username,
            personaName: connection.session?.personaName,
            payload: packet.payload,
            rawPayload: packet.rawPayload || decoded.payloadString,
          });

          this.emit('packet', connection, packet);
        }
      } catch (err) {
        console.error(`[TcpServer] Error decoding packet from ${connection.id}: ${(err as Error).message}`);
        this.emit('error', err as Error, connection);
      }
    }
  }

  /**
   * Cleans up disconnected sockets.
   */
  private handleConnectionClose(connection: FeslConnection, reason?: string): void {
    if (!this.connections.has(connection.id)) return;

    console.log(`[TcpServer] Connection closed: ${connection.id} (${reason || 'normal'})`);

    this.connections.delete(connection.id);
    connection.close(reason);

    // Notify inspector
    InspectorHub.getInstance().broadcastConnection({
      connectionId: connection.id,
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      serverPort: connection.serverPort,
      isTls: connection.isTls,
      timestamp: Date.now(),
      type: 'disconnected',
      reason,
    });

    this.emit('disconnect', connection, reason);
  }

  /**
   * Heartbeat / Activity timeout monitor.
   * Periodically checks if clients have exceeded `activityTimeoutSecs`.
   */
  private startActivityMonitor(): void {
    const intervalMs = 15000; // check every 15 seconds
    const timeoutMs = config.activityTimeoutSecs * 1000;

    this.activityCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, conn] of this.connections.entries()) {
        const inactiveMs = now - conn.lastActivityAt;
        if (inactiveMs > timeoutMs) {
          console.log(`[TcpServer] Disconnecting connection ${id} due to inactivity (${Math.round(inactiveMs / 1000)}s > ${config.activityTimeoutSecs}s)`);
          conn.close('Activity timeout');
          this.handleConnectionClose(conn, 'Activity timeout');
        }
      }
    }, intervalMs);

    this.activityCheckInterval.unref();
  }

  public getConnection(id: string): FeslConnection | undefined {
    return this.connections.get(id);
  }

  public getConnections(): FeslConnection[] {
    return Array.from(this.connections.values());
  }

  public getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Gracefully shuts down all listeners and disconnects active connections.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }

    for (const conn of this.connections.values()) {
      conn.close('Server shutdown');
    }
    this.connections.clear();

    for (const [port, server] of this.servers.entries()) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    this.servers.clear();
  }
}
