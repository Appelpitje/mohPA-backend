import { EventEmitter } from 'node:events';
import { FeslPacket, THEATER_SUBSYSTEMS } from '@mohpa/shared';
import { FeslConnection } from '../network/connection.js';
import { SessionStore } from '../session/types.js';
import { ApiClient } from '../api-client/api-client.js';
import { LobbyManager } from './lobby-manager.js';
import { TheaterCommandHandler, TheaterHandlerContext, getPacketTxn } from './types.js';
import {
  handleConn,
  handleUser,
  handleLlst,
  handleGlst,
  handleGdat,
  handleCgam,
  handleEgam,
  handleUpla,
  handleEcho,
  handlePing,
  handleKick,
  handleEcnl,
} from './handlers/index.js';

export interface TheaterRouterEvents {
  packet: (connection: FeslConnection, packet: FeslPacket) => void;
  handled: (connection: FeslConnection, request: FeslPacket, responsePayload?: Record<string, any>) => void;
  error: (error: Error, connection: FeslConnection, packet: FeslPacket) => void;
}

export class TheaterRouter extends EventEmitter {
  private handlers = new Map<string, TheaterCommandHandler>();
  private sessionStore: SessionStore;
  private apiClient: ApiClient;
  private lobbyManager: LobbyManager;

  constructor(
    sessionStore: SessionStore,
    apiClient: ApiClient,
    lobbyManager: LobbyManager
  ) {
    super();
    this.sessionStore = sessionStore;
    this.apiClient = apiClient;
    this.lobbyManager = lobbyManager;
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.registerSubsystem(THEATER_SUBSYSTEMS.CONN, handleConn);
    this.registerSubsystem(THEATER_SUBSYSTEMS.USER, handleUser);
    this.registerSubsystem(THEATER_SUBSYSTEMS.LLST, handleLlst);
    this.registerSubsystem(THEATER_SUBSYSTEMS.GLST, handleGlst);
    this.registerSubsystem(THEATER_SUBSYSTEMS.GDAT, handleGdat);
    this.registerSubsystem(THEATER_SUBSYSTEMS.CGAM, handleCgam);
    this.registerSubsystem(THEATER_SUBSYSTEMS.EGAM, handleEgam);
    this.registerSubsystem(THEATER_SUBSYSTEMS.UPLA, handleUpla);
    this.registerSubsystem(THEATER_SUBSYSTEMS.ECHO, handleEcho);
    this.registerSubsystem(THEATER_SUBSYSTEMS.PING, handlePing);
    this.registerSubsystem(THEATER_SUBSYSTEMS.KICK, handleKick);
    this.registerSubsystem(THEATER_SUBSYSTEMS.ECNL, handleEcnl);

    // Host notification ACK handlers
    this.registerSubsystem(THEATER_SUBSYSTEMS.EGRS, async (ctx) => {
      const tid = getPacketTxn(ctx.packet) || '1';
      return { TID: tid, SUCCESS: 1 };
    });
    this.registerSubsystem(THEATER_SUBSYSTEMS.PENT, async (ctx) => {
      const tid = getPacketTxn(ctx.packet) || '1';
      return { TID: tid, SUCCESS: 1 };
    });
  }

  /**
   * Registers a command handler for a 4-character Theater subsystem.
   */
  public registerSubsystem(subsystem: string, handler: TheaterCommandHandler): void {
    const key = subsystem.trim().toUpperCase();
    this.handlers.set(key, handler);
  }

  /**
   * Unregisters a command handler.
   */
  public unregisterSubsystem(subsystem: string): void {
    const key = subsystem.trim().toUpperCase();
    this.handlers.delete(key);
  }

  /**
   * Checks if a subsystem is registered in Theater router.
   */
  public hasSubsystem(subsystem: string): boolean {
    return this.handlers.has(subsystem.trim().toUpperCase());
  }

  /**
   * Dispatches an incoming Theater packet to the appropriate subsystem handler.
   */
  public async handlePacket(connection: FeslConnection, packet: FeslPacket): Promise<void> {
    const subsystemKey = packet.subsystem.trim().toUpperCase();
    const handler = this.handlers.get(subsystemKey);
    const tid = getPacketTxn(packet);

    this.emit('packet', connection, packet);

    const ctx: TheaterHandlerContext = {
      connection,
      packet,
      sessionStore: this.sessionStore,
      apiClient: this.apiClient,
      lobbyManager: this.lobbyManager,
    };

    if (!handler) {
      console.warn(`[TheaterRouter] No handler registered for Theater subsystem '${packet.subsystem}' (TID: ${tid || 'none'})`);
      connection.sendError(
        packet.subsystem,
        packet.subtype,
        tid || 'Unknown',
        `Unknown Theater subsystem: ${packet.subsystem}`
      );
      this.emit('handled', connection, packet);
      return;
    }

    try {
      const result = await handler(ctx);

      if (!result) {
        this.emit('handled', connection, packet);
        return;
      }

      // Format response packet with 0x80000000 response bit set
      const responseSubtype = (packet.subtype | 0x80000000) >>> 0;
      const responsePayload =
        'payload' in result && typeof result.payload === 'object'
          ? result.payload
          : result;

      connection.sendPacket({
        subsystem: packet.subsystem,
        subtype: responseSubtype,
        payload: responsePayload,
      });

      this.emit('handled', connection, packet, responsePayload);
    } catch (err) {
      console.error(
        `[TheaterRouter] Error handling ${packet.subsystem}.${tid || ''}: ${(err as Error).message}`,
        err
      );
      connection.sendError(
        packet.subsystem,
        packet.subtype,
        tid || 'Unknown',
        [{ fieldName: 'server', fieldError: (err as Error).message || 'Internal server error', fieldErrorCode: 5000 }]
      );
      this.emit('error', err as Error, connection, packet);
    }
  }
}
