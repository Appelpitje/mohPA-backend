/**
 * mohPA Standalone Mock Dedicated Game Server
 * Simulates an official BF2142/EA dedicated server hosting games on FESL (TLS) and Theater (TCP).
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import * as dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import {
  encodePacket,
  decodePacket,
  FESL_SUBSYSTEMS,
  FESL_TXN,
  THEATER_SUBSYSTEMS,
  DecodedPacket,
} from '@mohpa/shared';

export interface MockDedicatedServerOptions {
  feslHost?: string;
  feslPort?: number;
  theaterHost?: string;
  theaterPort?: number;
  serverName?: string;
  gameSlug?: string;
  gameIp?: string;
  gamePort?: number;
  queryPort?: number;
  maxPlayers?: number;
  mapName?: string;
  gameMode?: string;
  isRanked?: boolean;
  username?: string;
  password?: string;
  secretKey?: string;
  verbose?: boolean;
}

export interface DedicatedPlayer {
  pid: number;
  name: string;
  slot: number;
  team: number;
  status: string;
  joinedAt: number;
}

export class MockDedicatedServer extends EventEmitter {
  public feslHost: string;
  public feslPort: number;
  public theaterHost: string;
  public theaterPort: number;
  public serverName: string;
  public gameSlug: string;
  public gameIp: string;
  public gamePort: number;
  public queryPort: number;
  public maxPlayers: number;
  public mapName: string;
  public gameMode: string;
  public isRanked: boolean;
  public username: string;
  public password: string;
  public secretKey?: string;
  public verbose: boolean;

  private feslSocket: tls.TLSSocket | null = null;
  private theaterSocket: net.Socket | null = null;
  private querySocket: dgram.Socket | null = null;

  private feslBuffer = Buffer.alloc(0);
  private theaterBuffer = Buffer.alloc(0);

  private feslListeners: Array<(packet: DecodedPacket) => boolean> = [];
  private theaterListeners: Array<(packet: DecodedPacket) => boolean> = [];

  private feslSeq = 1;
  private theaterSeq = 1;

  public serverLkey: string | null = null;
  public gid: number | null = null;
  public lid = 1;
  public players = new Map<number, DedicatedPlayer>();
  public isRegistered = false;

  constructor(options: MockDedicatedServerOptions = {}) {
    super();
    this.feslHost = options.feslHost || '127.0.0.1';
    this.feslPort = options.feslPort || 18051;
    this.theaterHost = options.theaterHost || '127.0.0.1';
    this.theaterPort = options.theaterPort || 18056;
    this.serverName = options.serverName || 'mohPA Dedicated Server [Ranked]';
    this.gameSlug = options.gameSlug || 'mohpa';
    this.gameIp = options.gameIp || '127.0.0.1';
    this.gamePort = options.gamePort || 13200;
    this.queryPort = options.queryPort || 29900;
    this.maxPlayers = options.maxPlayers || 64;
    this.mapName = options.mapName || 'Henderson Airfield';
    this.gameMode = options.gameMode || 'Invader';
    this.isRanked = options.isRanked !== false;
    this.username = options.username || 'mohpa_server_host';
    this.password = options.password || 'DedicatedHostPassword123';
    this.secretKey = options.secretKey;
    this.verbose = options.verbose !== false;
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[MockDedicatedServer] ${message}`);
    }
  }

  // =========================================================================
  // FESL Protocol Layer
  // =========================================================================

  /**
   * Connects via TLS to FESL server port (18051).
   */
  public async connectFesl(): Promise<void> {
    this.log(`Connecting to FESL Server port at TLS ${this.feslHost}:${this.feslPort}...`);

    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: this.feslHost,
          port: this.feslPort,
          rejectUnauthorized: false,
        },
        () => {
          this.log(`TLS connection established with FESL Server (${this.feslHost}:${this.feslPort})`);
          this.feslSocket = socket;
          resolve();
        }
      );

      socket.on('data', (chunk: Buffer) => {
        this.feslBuffer = Buffer.concat([this.feslBuffer, chunk]);
        while (true) {
          const decoded = decodePacket(this.feslBuffer);
          if (!decoded) break;
          this.feslBuffer = this.feslBuffer.subarray(decoded.header.packetLength);

          for (let i = this.feslListeners.length - 1; i >= 0; i--) {
            if (this.feslListeners[i](decoded)) {
              this.feslListeners.splice(i, 1);
            }
          }
        }
      });

      socket.on('error', (err) => {
        this.log(`FESL server socket error: ${err.message}`);
        reject(err);
      });

      socket.on('close', () => {
        this.log('FESL server connection closed');
        this.feslSocket = null;
      });
    });
  }

  /**
   * Sends a FESL packet and awaits matching response.
   */
  public sendFeslPacket(
    subsystem: string,
    payload: Record<string, any>,
    timeoutMs = 5000
  ): Promise<DecodedPacket> {
    if (!this.feslSocket || this.feslSocket.destroyed) {
      return Promise.reject(new Error('FESL socket is not connected'));
    }

    const seq = this.feslSeq++;
    const encoded = encodePacket(subsystem, seq, payload);
    const txn = payload.TXN || payload.txn;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for FESL response to ${subsystem}.${txn || seq}`));
      }, timeoutMs);

      this.feslListeners.push((packet: DecodedPacket) => {
        const pTxn = packet.payload.TXN || packet.payload.txn;
        const matchesSubsystem = packet.header.subsystem.toLowerCase() === subsystem.toLowerCase();
        const matchesTxn = !txn || !pTxn || pTxn.toLowerCase() === txn.toLowerCase();

        if (matchesSubsystem && matchesTxn) {
          clearTimeout(timer);
          resolve(packet);
          return true;
        }
        return false;
      });

      this.feslSocket!.write(encoded);
    });
  }

  /**
   * Sends fsys.Hello handshake as dedicated server.
   */
  public async sendHello(): Promise<void> {
    this.log('Sending fsys.Hello as dedicated server...');
    const res = await this.sendFeslPacket(FESL_SUBSYSTEMS.FSYS, {
      TXN: FESL_TXN.HELLO,
      clientType: 'dedicated',
      sku: 'MOHPA-SERVER',
      locale: 'en_US',
      'domainPartition.name': 'mohpa-server',
    });

    if (res.payload.theaterHost) this.theaterHost = res.payload.theaterHost;
    if (res.payload.theaterPort) this.theaterPort = Number(res.payload.theaterPort);

    this.log(`Server fsys.Hello OK: Theater=${this.theaterHost}:${this.theaterPort}`);
  }

  /**
   * Authenticates dedicated server session via acct.NuLogin.
   */
  public async authenticate(): Promise<string> {
    this.log(`Authenticating dedicated server as '${this.username}'...`);
    const res = await this.sendFeslPacket(FESL_SUBSYSTEMS.ACCT, {
      TXN: FESL_TXN.NU_LOGIN,
      nuid: this.username,
      password: this.password,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`Server authentication failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    this.serverLkey = res.payload.lkey;
    if (!this.serverLkey) {
      throw new Error('Server authentication did not return lkey');
    }

    this.log(`Server authenticated: lkey=${this.serverLkey.substring(0, 8)}...`);
    return this.serverLkey;
  }

  // =========================================================================
  // Theater Protocol Layer
  // =========================================================================

  /**
   * Connects via TCP to Theater server port (18056).
   */
  public async connectTheater(): Promise<void> {
    this.log(`Connecting to Theater Server at TCP ${this.theaterHost}:${this.theaterPort}...`);

    return new Promise((resolve, reject) => {
      const socket = net.connect(
        {
          host: this.theaterHost,
          port: this.theaterPort,
        },
        () => {
          this.log(`TCP connection established with Theater Server (${this.theaterHost}:${this.theaterPort})`);
          this.theaterSocket = socket;
          this.setupTheaterPushHandlers();
          resolve();
        }
      );

      socket.on('data', (chunk: Buffer) => {
        this.theaterBuffer = Buffer.concat([this.theaterBuffer, chunk]);
        while (true) {
          const decoded = decodePacket(this.theaterBuffer);
          if (!decoded) break;
          this.theaterBuffer = this.theaterBuffer.subarray(decoded.header.packetLength);

          // Handle incoming push events (EGRQ, PENT, PLFT, ECHO)
          this.handleIncomingTheaterEvent(decoded);

          // Notify any pending request-response listeners
          for (let i = this.theaterListeners.length - 1; i >= 0; i--) {
            if (this.theaterListeners[i](decoded)) {
              this.theaterListeners.splice(i, 1);
            }
          }
        }
      });

      socket.on('error', (err) => {
        this.log(`Theater server socket error: ${err.message}`);
        reject(err);
      });

      socket.on('close', () => {
        this.log('Theater server connection closed');
        this.theaterSocket = null;
      });
    });
  }

  /**
   * Sends a Theater packet and awaits matching response.
   */
  public sendTheaterPacket(
    subsystem: string,
    payload: Record<string, any>,
    timeoutMs = 5000
  ): Promise<DecodedPacket> {
    if (!this.theaterSocket || this.theaterSocket.destroyed) {
      return Promise.reject(new Error('Theater server socket is not connected'));
    }

    const seq = this.theaterSeq++;
    const tid = payload.TID || payload.tid || String(seq);
    const packetPayload = { ...payload, TID: tid };
    const encoded = encodePacket(subsystem, seq, packetPayload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for Theater response to ${subsystem} (TID: ${tid})`));
      }, timeoutMs);

      this.theaterListeners.push((packet: DecodedPacket) => {
        const matchesSubsystem = packet.header.subsystem.toUpperCase() === subsystem.toUpperCase();
        const pTid = packet.payload.TID || packet.payload.tid;
        const matchesTid = !tid || !pTid || String(pTid) === String(tid);

        if (matchesSubsystem && matchesTid) {
          clearTimeout(timer);
          resolve(packet);
          return true;
        }
        return false;
      });

      this.theaterSocket!.write(encoded);
    });
  }

  /**
   * Authenticates Theater server connection using server LKEY.
   */
  public async theaterConn(): Promise<void> {
    if (!this.serverLkey) {
      throw new Error('No server LKEY available for Theater connection');
    }

    this.log('Sending Theater CONN with server LKEY...');
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.CONN, {
      LKEY: this.serverLkey,
      PROT: 2,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`Theater server CONN failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    this.log(`Theater server CONN OK: CID=${res.payload.CID}`);
  }

  /**
   * Registers dedicated game server with Theater via CGAM.
   */
  public async registerGame(): Promise<number> {
    this.log(`Registering dedicated game server '${this.serverName}' via CGAM...`);

    const cgamPayload: Record<string, any> = {
      LID: this.lid,
      NAME: `"${this.serverName}"`,
      IP: this.gameIp,
      PORT: this.gamePort,
      QPORT: this.queryPort,
      'MAX-PLAYERS': this.maxPlayers,
      TYPE: 'G',
      mapName: this.mapName,
      gameMode: this.gameMode,
      ranked: this.isRanked ? '1' : '0',
      dedicated: '1',
    };

    if (this.secretKey) {
      cgamPayload.SECRETKEY = this.secretKey;
    }

    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.CGAM, cgamPayload);

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`CGAM failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    this.gid = Number(res.payload.GID);
    this.isRegistered = true;

    this.log(`Dedicated server registered successfully! Assigned GID #${this.gid} on port ${this.gamePort}`);
    return this.gid;
  }

  /**
   * Sets up internal event routing for push notifications.
   */
  private setupTheaterPushHandlers(): void {
    // Handled in handleIncomingTheaterEvent
  }

  /**
   * Handles incoming Theater push notifications (EGRQ, PENT, PLFT).
   */
  private handleIncomingTheaterEvent(packet: DecodedPacket): void {
    const subsystem = packet.header.subsystem.toUpperCase();

    switch (subsystem) {
      case 'EGRQ': {
        // Enter Game Request: Client wants to enter our server
        const pid = Number(packet.payload.PID || 0);
        const name = packet.payload.NAME || `Player_${pid}`;
        const slot = Number(packet.payload.SLOT || 0);
        const ticket = packet.payload.TICKET || '';
        const ip = packet.payload.IP || '';

        this.log(`Received EGRQ (Join Request) from player '${name}' (PID #${pid}, Slot #${slot}, Ticket: ${ticket})`);

        // Acknowledge EGRQ by sending EGRS confirmation back to Theater
        if (this.theaterSocket && !this.theaterSocket.destroyed) {
          const egrsPacket = encodePacket(THEATER_SUBSYSTEMS.EGRS, 0x00000001, {
            TID: packet.payload.TID || '1',
            GID: this.gid || Number(packet.payload.GID),
            PID: pid,
            SUCCESS: 1,
          });
          this.theaterSocket.write(egrsPacket);
          this.log(`Sent EGRS (Join Acknowledged) for PID #${pid}`);
        }

        this.emit('playerJoinRequest', { pid, name, slot, ticket, ip });
        break;
      }

      case 'PENT': {
        // Player Entered: Client has entered game
        const pid = Number(packet.payload.PID || 0);
        const name = packet.payload.NAME || `Player_${pid}`;
        const slot = Number(packet.payload.SLOT || 0);
        const team = Number(packet.payload.TEAM || 0);
        const status = packet.payload.STATUS || 'active';

        const player: DedicatedPlayer = {
          pid,
          name,
          slot,
          team,
          status,
          joinedAt: Date.now(),
        };

        this.players.set(pid, player);
        this.log(`Player entered roster: '${name}' (PID #${pid}, Team ${team}, Total Players: ${this.players.size})`);

        this.emit('playerEntered', player);
        break;
      }

      case 'PLFT': {
        // Player Left
        const pid = Number(packet.payload.PID || 0);
        const reason = packet.payload.REASON || 'left';
        this.players.delete(pid);
        this.log(`Player PID #${pid} left game (${reason}). Remaining players: ${this.players.size}`);
        this.emit('playerLeft', { pid, reason });
        break;
      }

      case 'ECHO':
      case 'PING': {
        // Ping latency probe
        if (this.theaterSocket && !this.theaterSocket.destroyed) {
          const tid = packet.payload.TID || '1';
          const echoPacket = encodePacket(subsystem, (packet.header.subtype | 0x80000000) >>> 0, {
            TID: tid,
            TIME: Math.floor(Date.now() / 1000),
          });
          this.theaterSocket.write(echoPacket);
        }
        break;
      }
    }
  }

  /**
   * Helper that waits until a specific player joins the server.
   */
  public waitForPlayerJoin(expectedPid?: number, timeoutMs = 10000): Promise<DedicatedPlayer> {
    return new Promise((resolve, reject) => {
      // Check if already in roster
      if (expectedPid && this.players.has(expectedPid)) {
        return resolve(this.players.get(expectedPid)!);
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for player ${expectedPid || 'any'} to enter game`));
      }, timeoutMs);

      const onEntered = (player: DedicatedPlayer) => {
        if (!expectedPid || player.pid === expectedPid) {
          clearTimeout(timer);
          this.off('playerEntered', onEntered);
          resolve(player);
        }
      };

      this.on('playerEntered', onEntered);
    });
  }

  /**
   * Starts a UDP query listener on queryPort to respond to GameSpy 1 and Quake 3 status queries.
   */
  public async startQueryListener(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        const socket = dgram.createSocket('udp4');
        socket.on('error', (err) => {
          this.log(`Query socket error: ${err.message}`);
        });

        socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
          const str = msg.toString('binary');
          const asciiStr = msg.toString('utf-8');

          // Quake 3 probe
          if (str.includes('getstatus') || str.includes('getinfo')) {
            const playerLines = Array.from(this.players.values())
              .map((p, idx) => `${100 - idx * 10} 35 "${p.name}"`)
              .join('\n');

            const resp = `\xFF\xFF\xFF\xFFstatusResponse\n\\sv_hostname\\${this.serverName}\\mapname\\${this.mapName}\\gametype\\${this.gameMode}\\sv_maxclients\\${this.maxPlayers}\\numplayers\\${this.players.size}\\version\\MOHPA 1.2\\pure\\1\\dedicated\\1\n${playerLines}${playerLines ? '\n' : ''}`;
            const buf = Buffer.from(resp, 'binary');
            socket.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {});
            return;
          }

          // GameSpy 1 probe
          if (asciiStr.includes('status') || asciiStr.includes('info')) {
            const playerParts: string[] = [];
            let pIdx = 0;
            for (const p of this.players.values()) {
              playerParts.push(
                `\\player_${pIdx}\\${p.name}\\score_${pIdx}\\${100 - pIdx * 10}\\ping_${pIdx}\\35\\team_${pIdx}\\${p.team || 0}`
              );
              pIdx++;
            }

            const resp = `\\hostname\\${this.serverName}\\hostport\\${this.gamePort}\\mapname\\${this.mapName}\\gametype\\${this.gameMode}\\numplayers\\${this.players.size}\\maxplayers\\${this.maxPlayers}\\gamever\\1.2\\dedicated\\1${playerParts.join('')}\\final\\`;
            const buf = Buffer.from(resp, 'utf-8');
            socket.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {});
            return;
          }
        });

        socket.bind(this.queryPort, '0.0.0.0', () => {
          this.querySocket = socket;
          const addr = socket.address();
          this.log(`UDP Query Listener active on 0.0.0.0:${addr.port} (GameSpy 1 & Quake 3)`);
          resolve(addr.port);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Shuts down and disconnects dedicated server sockets.
   */
  public async stop(): Promise<void> {
    this.log('Shutting down Mock Dedicated Server...');

    if (this.querySocket) {
      try {
        this.querySocket.close();
      } catch {}
      this.querySocket = null;
    }

    if (this.theaterSocket && !this.theaterSocket.destroyed) {
      this.theaterSocket.end();
      this.theaterSocket.destroy();
      this.theaterSocket = null;
    }

    if (this.feslSocket && !this.feslSocket.destroyed) {
      try {
        await this.sendFeslPacket(FESL_SUBSYSTEMS.FSYS, { TXN: FESL_TXN.GOODBYE }, 1000).catch(() => {});
      } catch {}
      this.feslSocket.end();
      this.feslSocket.destroy();
      this.feslSocket = null;
    }

    this.isRegistered = false;
    this.players.clear();
    this.log('Mock Dedicated Server stopped.');
  }

  /**
   * Complete startup and registration lifecycle.
   */
  public async start(): Promise<number> {
    await this.startQueryListener().catch((err) => {
      this.log(`Warning: could not bind query listener on port ${this.queryPort}: ${err.message}`);
    });
    await this.connectFesl();
    await this.sendHello();
    await this.authenticate();
    await this.connectTheater();
    await this.theaterConn();
    const gid = await this.registerGame();
    return gid;
  }
}

// Standalone execution entrypoint
if (
  process.argv[1] &&
  (process.argv[1].endsWith('mock-dedicated-server.ts') || process.argv[1].endsWith('mock-dedicated-server.js'))
) {
  const server = new MockDedicatedServer();
  console.log('=== Starting mohPA Mock Dedicated Game Server ===');
  server
    .start()
    .then((gid) => {
      console.log(`=== Dedicated Server Active (GID #${gid}) ===`);
      console.log('Listening for incoming client game connections...');
    })
    .catch((err) => {
      console.error('Fatal Dedicated Server error:', err);
      process.exit(1);
    });
}
