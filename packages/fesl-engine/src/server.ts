import { TcpServer, PortListenerConfig } from './network/tcp-server.js';
import { TlsManager } from './network/tls-manager.js';
import { RedisSessionStore } from './session/redis-session-store.js';
import { ApiClient } from './api-client/api-client.js';
import { FeslRouter } from './fesl/router.js';
import { TheaterRouter } from './theater/router.js';
import { LobbyManager } from './theater/lobby-manager.js';
import { InspectorHub } from './inspector/inspector-hub.js';
import { config, FeslEngineConfig } from './config/config.js';
import { FeslConnection } from './network/connection.js';
import { FeslPacket, queryGameServer, resolveIpLocation } from '@centralspy/shared';
import { GpcmServer } from './gamespy/gpcm-server.js';
import { GsPspServer } from './gamespy/gpsp-server.js';
import { GsAvailableServer } from './gamespy/available-server.js';
import { GsStatsServer } from './gamespy/gstats-server.js';
import { GsMasterServer } from './gamespy/master-server.js';
import { GsServerBrowser } from './gamespy/server-browser.js';
import { PeerchatServer } from './gamespy/peerchat-server.js';
import { GameServerRegistry } from './gamespy/server-registry.js';

export interface FeslServerOptions {
  config?: Partial<FeslEngineConfig>;
  ports?: PortListenerConfig[];
  tlsManager?: TlsManager;
  sessionStore?: RedisSessionStore;
  apiClient?: ApiClient;
  lobbyManager?: LobbyManager;
  theaterRouter?: TheaterRouter;
}

export class FeslEngineServer {
  public readonly tlsManager: TlsManager;
  public readonly sessionStore: RedisSessionStore;
  public readonly apiClient: ApiClient;
  public readonly router: FeslRouter;
  public readonly lobbyManager: LobbyManager;
  public readonly theaterRouter: TheaterRouter;
  public readonly tcpServer: TcpServer;
  public readonly inspectorHub: InspectorHub;
  public readonly gpcmServer: GpcmServer;
  public readonly gpspServer: GsPspServer;
  public readonly availableServer: GsAvailableServer;
  public readonly gstatsServer: GsStatsServer;
  public readonly masterServer: GsMasterServer;
  public readonly masterServerAlt: GsMasterServer;
  public readonly serverBrowser: GsServerBrowser;
  public readonly masterServerSb: GsMasterServer;
  public readonly peerchatServer: PeerchatServer;
  public readonly peerchatServerAlt: PeerchatServer;
  public readonly serverRegistry: GameServerRegistry;
  private seedTimer: NodeJS.Timeout | null = null;

  constructor(options: FeslServerOptions = {}) {
    this.tlsManager = options.tlsManager || TlsManager.getInstance();
    this.sessionStore = options.sessionStore || new RedisSessionStore();
    this.apiClient = options.apiClient || new ApiClient();
    this.router = new FeslRouter(this.sessionStore, this.apiClient);
    this.lobbyManager = options.lobbyManager || new LobbyManager(this.apiClient);
    this.theaterRouter =
      options.theaterRouter ||
      new TheaterRouter(this.sessionStore, this.apiClient, this.lobbyManager);
    this.tcpServer = new TcpServer(this.tlsManager);
    this.inspectorHub = InspectorHub.getInstance();
    this.gpcmServer = new GpcmServer();
    this.gpspServer = new GsPspServer();
    this.serverRegistry = new GameServerRegistry({ publicIp: config.publicIp });
    this.availableServer = new GsAvailableServer(this.serverRegistry);
    this.gstatsServer = new GsStatsServer();
    this.masterServer = new GsMasterServer(this.serverRegistry);
    this.masterServerAlt = new GsMasterServer(this.serverRegistry);
    this.serverBrowser = new GsServerBrowser(this.serverRegistry);
    this.masterServerSb = new GsMasterServer(this.serverRegistry);
    this.peerchatServer = new PeerchatServer();
    this.peerchatServerAlt = new PeerchatServer();

    this.setupEventPipes();
  }

  private setupEventPipes(): void {
    // Pipe packets from TCP server to FESL Router or Theater Router
    this.tcpServer.on('packet', (connection: FeslConnection, packet: FeslPacket) => {
      const isTheaterPort =
        connection.serverPort === config.theaterClientPort ||
        connection.serverPort === config.theaterServerPort;
      const isTheaterSubsystem = this.theaterRouter.hasSubsystem(packet.subsystem);

      if (isTheaterPort || isTheaterSubsystem) {
        this.theaterRouter.handlePacket(connection, packet).catch((err) => {
          console.error(
            `[FeslEngineServer] Uncaught error in Theater packet handler: ${(err as Error).message}`
          );
        });
      } else {
        this.router.handlePacket(connection, packet).catch((err) => {
          console.error(
            `[FeslEngineServer] Uncaught error in FESL packet handler: ${(err as Error).message}`
          );
        });
      }
    });

    this.tcpServer.on('disconnect', (connection: FeslConnection, _reason?: string) => {
      // Clean up lobby manager state on disconnect
      this.lobbyManager.handleDisconnect(connection);
    });
  }

  /**
   * Starts all TCP/TLS listeners and WebSocket inspector.
   */
  public async start(ports?: PortListenerConfig[]): Promise<void> {
    console.log('[FeslEngineServer] Initializing CentralSpy FESL Engine...');

    // Initialize TLS Manager (loads or generates dev certs)
    this.tlsManager.getCertificates();

    // Start WebSocket inspector
    this.inspectorHub.start(config.inspectorPort);

    // Start TCP/TLS listeners
    await this.tcpServer.start(ports);
    if (process.env.NODE_ENV !== 'test') {
      if (config.gpcmPort > 0) {
        await this.gpcmServer.start(config.host, config.gpcmPort);
      }
      if (config.gpspPort > 0) {
        await this.gpspServer.start(config.host, config.gpspPort);
      }
      if (config.availablePort > 0) {
        await this.availableServer.start(config.host, config.availablePort);
      }
      if (config.gstatsPort > 0) {
        await this.gstatsServer.start(config.host, config.gstatsPort);
      }
      if (config.masterPort > 0) {
        await this.masterServer.start(config.host, config.masterPort);
      }
      if (config.masterAltPort > 0 && config.masterAltPort !== config.masterPort) {
        await this.masterServerAlt.start(config.host, config.masterAltPort);
      }
      if (config.sbPort > 0) {
        // MOHPA's in-game browser connects to TCP 28910 and waits for a GOA
        // `\basic\\secure\` greeting (it does not send an SB v2 list request).
        // Serve the compact GOA list there. Keep the SB v2 listener available
        // on GS_SB_V2_PORT if set.
        await this.masterServerSb.start(config.host, config.sbPort);
        const sbV2Port = parseInt(process.env.GS_SB_V2_PORT || '0', 10);
        if (sbV2Port > 0) {
          await this.serverBrowser.start(config.host, sbV2Port);
        }
      }
      if (config.peerchatPort > 0) {
        await this.peerchatServer.start(config.host, config.peerchatPort);
      }
      if (config.peerchatAltPort > 0) {
        await this.peerchatServerAlt.start(config.host, config.peerchatAltPort);
      }
      await this.seedDedicatedServer();
      this.seedTimer = setInterval(() => {
        this.seedDedicatedServer().catch((err) => {
          console.warn(`[FeslEngineServer] dedicated seed failed: ${(err as Error).message}`);
        });
      }, 60000);
    }

    console.log('[FeslEngineServer] CentralSpy FESL Engine successfully started.');
  }

  private async seedDedicatedServer(): Promise<void> {
    const advertiseHost = process.env.DEDICATED_SERVER_IP || config.publicIp;
    const gamePort = parseInt(process.env.DEDICATED_GAME_PORT || '13200', 10);
    const queryPort = parseInt(process.env.DEDICATED_QUERY_PORT || '13300', 10);

    const apiServers = await this.apiClient.listGameServers({ gameSlug: 'mohpa', isOnline: true });
    for (const listed of apiServers) {
      const ip = listed.ipAddress || listed.ip_address;
      const port = Number(listed.queryPort || listed.query_port || listed.port);
      if (ip && port) {
        this.serverRegistry.upsert({
          ip,
          port,
          gamename: listed.gameSlug || listed.game_slug || 'mohpa',
          gamePort: Number(listed.port) || gamePort,
        });
      }
    }

    const queryHosts = [
      ...new Set(
        [process.env.DEDICATED_QUERY_HOST, advertiseHost, 'host.docker.internal', '172.17.0.1'].filter(
          (value): value is string => Boolean(value)
        )
      ),
    ];
    let query = null;
    for (const queryHost of queryHosts) {
      query = await queryGameServer({
        host: queryHost,
        port: gamePort,
        queryPort,
        gameSlug: 'mohpa',
        timeoutMs: 1500,
      });
      if (query.online) {
        break;
      }
    }
    if (!query?.online) {
      return;
    }

    const advertisedPort = query.queryPort || queryPort;
    this.serverRegistry.upsert({
      ip: advertiseHost,
      port: advertisedPort,
      gamename: 'mohpa',
      gamePort,
    });
    const geo = resolveIpLocation(advertiseHost);
    const tickRate = Number(
      query.rules?.sv_fps ||
      query.rules?.tickrate ||
      query.rules?.fps ||
      30
    );
    await this.apiClient.registerGameServer({
      name: query.name || 'MOHPA Dedicated',
      gameSlug: 'mohpa',
      ipAddress: advertiseHost,
      port: gamePort,
      queryPort: advertisedPort,
      maxPlayers: query.maxPlayers || 16,
      skipQuery: true,
      mapName: query.mapName,
      gameMode: query.gameMode,
      currentPlayers: query.currentPlayers,
      region: geo.region,
      country: geo.country,
      countryCode: geo.countryCode,
      city: geo.city,
      ping: query.ping,
      tickRate,
      details: {
        players: query.players || [],
        rules: query.rules || {},
        ping: query.ping,
        tickRate,
        region: geo.region,
        countryCode: geo.countryCode,
        country: geo.country,
        city: geo.city,
        queryProtocol: query.protocol,
        queryPort: advertisedPort,
        lastQueried: new Date().toISOString(),
      },
    });
    console.log(
      `[FeslEngineServer] Seeded GameSpy list with ${advertiseHost}:${advertisedPort} (${query.name || 'unnamed'})`
    );
  }

  /**
   * Gracefully shuts down listeners and connections.
   */
  public async stop(): Promise<void> {
    console.log('[FeslEngineServer] Shutting down FESL Engine...');
    if (this.seedTimer) {
      clearInterval(this.seedTimer);
      this.seedTimer = null;
    }
    this.lobbyManager.clear();
    await this.gpcmServer.stop();
    await this.gpspServer.stop();
    await this.availableServer.stop();
    await this.gstatsServer.stop();
    await this.masterServer.stop();
    await this.masterServerAlt.stop();
    await this.serverBrowser.stop();
    await this.masterServerSb.stop();
    await this.peerchatServer.stop();
    await this.peerchatServerAlt.stop();
    await this.tcpServer.stop();
    await this.sessionStore.close();
    this.inspectorHub.close();
    console.log('[FeslEngineServer] FESL Engine stopped.');
  }
}
