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
import { FeslPacket } from '@centralspy/shared';

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

    console.log('[FeslEngineServer] CentralSpy FESL Engine successfully started.');
  }

  /**
   * Gracefully shuts down listeners and connections.
   */
  public async stop(): Promise<void> {
    console.log('[FeslEngineServer] Shutting down FESL Engine...');
    this.lobbyManager.clear();
    await this.tcpServer.stop();
    await this.sessionStore.close();
    this.inspectorHub.close();
    console.log('[FeslEngineServer] FESL Engine stopped.');
  }
}
