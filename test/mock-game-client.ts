/**
 * CentralSpy Standalone Mock Game Client
 * Simulates a full Battlefield / EA game client connecting to FESL (TLS) and Theater (TCP).
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import {
  encodePacket,
  decodePacket,
  FESL_SUBSYSTEMS,
  FESL_TXN,
  THEATER_SUBSYSTEMS,
  DecodedPacket,
} from '@centralspy/shared';

export interface MockGameClientOptions {
  feslHost?: string;
  feslPort?: number;
  theaterHost?: string;
  theaterPort?: number;
  username?: string;
  password?: string;
  gameSlug?: string;
  personaName?: string;
  sku?: string;
  locale?: string;
  verbose?: boolean;
}

export interface HelloResult {
  theaterHost: string;
  theaterPort: number;
  curTime: string;
  domainPartition: string;
  activityTimeoutSecs: number;
}

export interface LoginResult {
  lkey: string;
  userId: number | string;
  displayName?: string;
}

export interface PersonaLoginResult {
  lkey: string;
  personaId: number;
  name: string;
  userId: number | string;
}

export interface JoinGameResult {
  gid: number;
  lid: number;
  ip: string;
  port: number;
  ticket: string;
  slot: number;
  pid: number;
}

export class MockGameClient {
  public feslHost: string;
  public feslPort: number;
  public theaterHost: string;
  public theaterPort: number;
  public username: string;
  public password: string;
  public gameSlug: string;
  public preferredPersonaName?: string;
  public sku: string;
  public locale: string;
  public verbose: boolean;

  private feslSocket: tls.TLSSocket | null = null;
  private theaterSocket: net.Socket | null = null;

  private feslBuffer = Buffer.alloc(0);
  private theaterBuffer = Buffer.alloc(0);

  private feslListeners: Array<(packet: DecodedPacket) => boolean> = [];
  private theaterListeners: Array<(packet: DecodedPacket) => boolean> = [];

  private feslSeq = 1;
  private theaterSeq = 1;

  public masterLkey: string | null = null;
  public personaLkey: string | null = null;
  public userId: number | string | null = null;
  public personaId: number | null = null;
  public personaName: string | null = null;
  public personas: string[] = [];

  constructor(options: MockGameClientOptions = {}) {
    this.feslHost = options.feslHost || '127.0.0.1';
    this.feslPort = options.feslPort || 18270;
    this.theaterHost = options.theaterHost || '127.0.0.1';
    this.theaterPort = options.theaterPort || 18275;
    this.username = options.username || 'TestCommander';
    this.password = options.password || 'SecretPassword123';
    this.gameSlug = options.gameSlug || 'mohpa';
    this.preferredPersonaName = options.personaName;
    this.sku = options.sku || 'MOHPA-PC';
    this.locale = options.locale || 'en_US';
    this.verbose = options.verbose !== false;
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[MockGameClient] ${message}`);
    }
  }

  // =========================================================================
  // FESL Connection & Protocol Methods
  // =========================================================================

  /**
   * Connects to FESL server via TLS.
   */
  public async connectFesl(): Promise<void> {
    this.log(`Connecting to FESL at TLS ${this.feslHost}:${this.feslPort}...`);

    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: this.feslHost,
          port: this.feslPort,
          rejectUnauthorized: false,
        },
        () => {
          this.log(`TLS handshake established with FESL (${this.feslHost}:${this.feslPort})`);
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
        this.log(`FESL socket error: ${err.message}`);
        reject(err);
      });

      socket.on('close', () => {
        this.log('FESL connection closed');
        this.feslSocket = null;
      });
    });
  }

  /**
   * Sends a FESL packet and waits for matching response.
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
   * Sends fsys.Hello handshake.
   */
  public async sendHello(): Promise<HelloResult> {
    this.log('Sending fsys.Hello...');
    const res = await this.sendFeslPacket(FESL_SUBSYSTEMS.FSYS, {
      TXN: FESL_TXN.HELLO,
      clientType: 'client',
      sku: this.sku,
      locale: this.locale,
      'domainPartition.name': 'eagames',
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`fsys.Hello failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    const result: HelloResult = {
      theaterHost: res.payload.theaterHost || this.theaterHost,
      theaterPort: Number(res.payload.theaterPort || this.theaterPort),
      curTime: String(res.payload.curTime || ''),
      domainPartition: String(res.payload['domainPartition.name'] || 'eagames'),
      activityTimeoutSecs: Number(res.payload.activityTimeoutSecs || 120),
    };

    if (result.theaterHost) this.theaterHost = result.theaterHost;
    if (result.theaterPort) this.theaterPort = result.theaterPort;

    this.log(`fsys.Hello successful: curTime=${result.curTime}, theater=${result.theaterHost}:${result.theaterPort}`);
    return result;
  }

  /**
   * Authenticates user via acct.NuLogin.
   */
  public async sendNuLogin(): Promise<LoginResult> {
    this.log(`Sending acct.NuLogin for user '${this.username}'...`);
    const res = await this.sendFeslPacket(FESL_SUBSYSTEMS.ACCT, {
      TXN: FESL_TXN.NU_LOGIN,
      nuid: this.username,
      password: this.password,
      returnEncryptedInfo: 1,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`acct.NuLogin failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    this.masterLkey = res.payload.lkey;
    this.userId = res.payload.userId || res.payload.profileId;

    if (!this.masterLkey) {
      throw new Error('acct.NuLogin did not return master lkey');
    }

    this.log(`acct.NuLogin successful: userId=${this.userId}, masterLkey=${this.masterLkey.substring(0, 8)}...`);
    return {
      lkey: this.masterLkey,
      userId: this.userId,
      displayName: res.payload.displayName || this.username,
    };
  }

  /**
   * Retrieves persona/soldier list via acct.NuGetPersonas.
   */
  public async getPersonas(): Promise<string[]> {
    this.log('Sending acct.NuGetPersonas...');
    const res = await this.sendFeslPacket(FESL_SUBSYSTEMS.ACCT, {
      TXN: FESL_TXN.NU_GET_PERSONAS,
      lkey: this.masterLkey,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`acct.NuGetPersonas failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    const personasRaw = res.payload.personas;
    this.personas = Array.isArray(personasRaw)
      ? personasRaw.map((p) => (typeof p === 'string' ? p : p.name || String(p)))
      : [];

    this.log(`acct.NuGetPersonas received ${this.personas.length} soldiers: [${this.personas.join(', ')}]`);
    return this.personas;
  }

  /**
   * Authenticates selected soldier persona via acct.NuLoginPersona.
   */
  public async loginPersona(personaName?: string): Promise<PersonaLoginResult> {
    const targetPersona =
      personaName ||
      this.preferredPersonaName ||
      (this.personas.length > 0 ? this.personas[0] : 'Col_Voss');

    this.log(`Sending acct.NuLoginPersona for soldier '${targetPersona}'...`);
    const res = await this.sendFeslPacket(FESL_SUBSYSTEMS.ACCT, {
      TXN: FESL_TXN.NU_LOGIN_PERSONA,
      lkey: this.masterLkey,
      name: targetPersona,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`acct.NuLoginPersona failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    this.personaLkey = res.payload.lkey;
    this.personaId = Number(res.payload.personaId || 101);
    this.personaName = targetPersona;

    if (!this.personaLkey) {
      throw new Error('acct.NuLoginPersona did not return persona lkey');
    }

    this.log(`acct.NuLoginPersona successful: personaId=${this.personaId}, personaLkey=${this.personaLkey.substring(0, 8)}...`);
    return {
      lkey: this.personaLkey,
      personaId: this.personaId,
      name: this.personaName,
      userId: this.userId || 1,
    };
  }

  // =========================================================================
  // Theater Connection & Protocol Methods
  // =========================================================================

  /**
   * Connects to Theater server via plain TCP.
   */
  public async connectTheater(): Promise<void> {
    this.log(`Connecting to Theater at TCP ${this.theaterHost}:${this.theaterPort}...`);

    return new Promise((resolve, reject) => {
      const socket = net.connect(
        {
          host: this.theaterHost,
          port: this.theaterPort,
        },
        () => {
          this.log(`TCP connection established with Theater (${this.theaterHost}:${this.theaterPort})`);
          this.theaterSocket = socket;
          resolve();
        }
      );

      socket.on('data', (chunk: Buffer) => {
        this.theaterBuffer = Buffer.concat([this.theaterBuffer, chunk]);
        while (true) {
          const decoded = decodePacket(this.theaterBuffer);
          if (!decoded) break;
          this.theaterBuffer = this.theaterBuffer.subarray(decoded.header.packetLength);

          for (let i = this.theaterListeners.length - 1; i >= 0; i--) {
            if (this.theaterListeners[i](decoded)) {
              this.theaterListeners.splice(i, 1);
            }
          }
        }
      });

      socket.on('error', (err) => {
        this.log(`Theater socket error: ${err.message}`);
        reject(err);
      });

      socket.on('close', () => {
        this.log('Theater connection closed');
        this.theaterSocket = null;
      });
    });
  }

  /**
   * Sends a Theater packet and waits for matching response.
   */
  public sendTheaterPacket(
    subsystem: string,
    payload: Record<string, any>,
    timeoutMs = 5000
  ): Promise<DecodedPacket> {
    if (!this.theaterSocket || this.theaterSocket.destroyed) {
      return Promise.reject(new Error('Theater socket is not connected'));
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
   * Authenticates Theater connection using persona LKEY.
   */
  public async theaterConn(): Promise<Record<string, any>> {
    const lkeyToUse = this.personaLkey || this.masterLkey;
    if (!lkeyToUse) {
      throw new Error('No LKEY available to authenticate Theater connection');
    }

    this.log(`Sending Theater CONN with persona LKEY...`);
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.CONN, {
      LKEY: lkeyToUse,
      PROT: 2,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`Theater CONN failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    this.log(`Theater CONN successful: CID=${res.payload.CID}, NAME=${res.payload.NAME}`);
    return res.payload;
  }

  /**
   * Sends USER command to resolve Theater user profile.
   */
  public async theaterUser(): Promise<Record<string, any>> {
    this.log('Sending Theater USER...');
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.USER, {
      CID: this.personaId || 101,
    });
    this.log(`Theater USER verified: NAME=${res.payload.NAME}`);
    return res.payload;
  }

  /**
   * Queries available game lobbies via LLST.
   */
  public async listLobbies(): Promise<any[]> {
    this.log('Sending Theater LLST (List Lobbies)...');
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.LLST, {});
    const count = Number(res.payload['NUM-LOBBIES'] || 0);
    this.log(`Theater LLST returned ${count} lobbies`);
    return [];
  }

  /**
   * Queries active game servers via GLST.
   */
  public async listGames(lid = 1): Promise<any[]> {
    this.log(`Sending Theater GLST for Lobby #${lid}...`);
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.GLST, {
      LID: lid,
      'MAX-GAMES': 20,
    });

    const numGames = Number(res.payload['NUM-GAMES'] || 0);
    this.log(`Theater GLST found ${numGames} active game servers`);

    const games: any[] = [];
    if (numGames > 0 && res.payload.GID) {
      games.push({
        gid: Number(res.payload.GID),
        lid: Number(res.payload.LID || lid),
        name: res.payload.NAME,
        ip: res.payload.IP,
        port: Number(res.payload.PORT),
        numPlayers: Number(res.payload['NUM-PLAYERS'] || 0),
        maxPlayers: Number(res.payload['MAX-PLAYERS'] || 64),
      });
    }

    for (let i = 0; i < numGames; i++) {
      if (res.payload[`${i}.GID`]) {
        games.push({
          gid: Number(res.payload[`${i}.GID`]),
          lid: Number(res.payload[`${i}.LID`] || lid),
          name: res.payload[`${i}.NAME`],
          ip: res.payload[`${i}.IP`],
          port: Number(res.payload[`${i}.PORT`]),
          numPlayers: Number(res.payload[`${i}.NUM-PLAYERS`] || 0),
          maxPlayers: Number(res.payload[`${i}.MAX-PLAYERS`] || 64),
        });
      }
    }

    return games;
  }

  /**
   * Enters a game session via EGAM.
   */
  public async enterGame(gid: number, team = 1): Promise<JoinGameResult> {
    this.log(`Sending Theater EGAM to join Game #${gid} (Team ${team})...`);
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.EGAM, {
      GID: gid,
      PID: this.personaId || 101,
      NAME: this.personaName || this.username,
      TEAM: team,
    });

    if (res.payload.errorContainer && res.payload.errorContainer.length > 0) {
      throw new Error(`Theater EGAM failed: ${JSON.stringify(res.payload.errorContainer)}`);
    }

    const joinResult: JoinGameResult = {
      gid: Number(res.payload.GID || gid),
      lid: Number(res.payload.LID || 1),
      ip: res.payload.IP || '127.0.0.1',
      port: Number(res.payload.PORT || 16567),
      ticket: String(res.payload.TICKET || ''),
      slot: Number(res.payload.SLOT || 0),
      pid: Number(res.payload.PID || this.personaId || 101),
    };

    this.log(`Theater EGAM successful: Joined GID #${joinResult.gid}, Ticket=${joinResult.ticket}, Slot=${joinResult.slot}`);
    return joinResult;
  }

  /**
   * Updates player attributes in active game session via UPLA.
   */
  public async updatePlayerAttributes(
    gid: number,
    attrs: { score?: number; kills?: number; deaths?: number; ping?: number; team?: number }
  ): Promise<boolean> {
    this.log(`Sending Theater UPLA (Score: ${attrs.score}, Kills: ${attrs.kills}, Ping: ${attrs.ping})...`);
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.UPLA, {
      GID: gid,
      PID: this.personaId || 101,
      SCORE: attrs.score ?? 100,
      KILLS: attrs.kills ?? 1,
      DEATHS: attrs.deaths ?? 0,
      PING: attrs.ping ?? 25,
      TEAM: attrs.team ?? 1,
      STATUS: 'active',
    });

    const success = Number(res.payload.SUCCESS) === 1;
    this.log(`Theater UPLA result: ${success ? 'OK' : 'Failed'}`);
    return success;
  }

  /**
   * Pings Theater server to test latency.
   */
  public async pingTheater(): Promise<number> {
    const clientTime = Math.floor(Date.now() / 1000);
    const res = await this.sendTheaterPacket(THEATER_SUBSYSTEMS.PING, {
      'CLIENT-TIME': clientTime,
    });
    return Number(res.payload.TIME || clientTime);
  }

  /**
   * Gracefully disconnects from Theater and FESL.
   */
  public async disconnect(): Promise<void> {
    this.log('Disconnecting Mock Game Client...');

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

    this.log('Mock Game Client disconnected successfully.');
  }

  /**
   * Runs the complete end-to-end client login and game join lifecycle.
   */
  public async runFullFlow(targetGid?: number): Promise<{
    login: LoginResult;
    persona: PersonaLoginResult;
    joinGame?: JoinGameResult;
  }> {
    // 1. Connect FESL & Send Hello Handshake
    await this.connectFesl();
    await this.sendHello();

    // 2. Master Account Login & Fetch Personas
    const login = await this.sendNuLogin();
    await this.getPersonas();

    // 3. Login Selected Persona
    const persona = await this.loginPersona();

    // 4. Connect Theater & Handshake
    await this.connectTheater();
    await this.theaterConn();
    await this.theaterUser();
    await this.listLobbies();

    // 5. Query Servers & Join Game
    const games = await this.listGames();
    let joinGame: JoinGameResult | undefined;

    const gidToJoin = targetGid || (games.length > 0 ? games[0].gid : undefined);
    if (gidToJoin !== undefined) {
      joinGame = await this.enterGame(gidToJoin);
      await this.updatePlayerAttributes(gidToJoin, {
        score: 1500,
        kills: 12,
        deaths: 2,
        ping: 28,
        team: 1,
      });
      await this.pingTheater();
    }

    return { login, persona, joinGame };
  }
}

// Standalone execution entrypoint
if (
  process.argv[1] &&
  (process.argv[1].endsWith('mock-game-client.ts') || process.argv[1].endsWith('mock-game-client.js'))
) {
  const client = new MockGameClient();
  console.log('=== Starting CentralSpy Mock Game Client Simulation ===');
  client
    .runFullFlow()
    .then((result) => {
      console.log('=== Mock Game Client Flow Complete ===');
      console.log('User:', result.login.displayName);
      console.log('Persona:', result.persona.name);
      if (result.joinGame) {
        console.log('Joined Game GID:', result.joinGame.gid);
      }
      return client.disconnect();
    })
    .catch((err) => {
      console.error('Fatal Mock Game Client error:', err);
      process.exit(1);
    });
}
