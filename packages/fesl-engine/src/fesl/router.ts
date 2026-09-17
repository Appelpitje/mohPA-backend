import { EventEmitter } from 'node:events';
import { FeslPacket, FESL_SUBSYSTEMS } from '@mohpa/shared';
import { FeslConnection } from '../network/connection.js';
import { SessionStore } from '../session/types.js';
import { ApiClient } from '../api-client/api-client.js';
import { FeslCommandHandler, FeslHandlerContext, getPacketTxn } from './types.js';
import { redactSensitive } from '../utils/redact.js';
import {
  handleFsys,
  handleAcct,
  handleSubs,
  handleDobj,
  handleRank,
  handleGsum,
  handlePnow,
} from './handlers/index.js';

export interface FeslRouterEvents {
  packet: (connection: FeslConnection, packet: FeslPacket) => void;
  handled: (connection: FeslConnection, request: FeslPacket, responsePayload?: Record<string, any>) => void;
  error: (error: Error, connection: FeslConnection, packet: FeslPacket) => void;
}

/**
 * Jabba FESL (MOHPA) matches replies by payload TID, not the header subtype.
 * A response that omits TID is dropped ("tid %d not found") and the pending
 * request times out as a connect error.
 */
function echoRequestTid(payload: Record<string, any>, request: FeslPacket): Record<string, any> {
  const tid = request.payload.TID ?? request.payload.tid;
  if (tid === undefined || tid === null || tid === '') {
    return payload;
  }
  if (payload.TID === undefined && payload.tid === undefined) {
    payload.TID = tid;
  }
  return payload;
}

export class FeslRouter extends EventEmitter {
  private handlers = new Map<string, FeslCommandHandler>();
  private sessionStore: SessionStore;
  private apiClient: ApiClient;

  constructor(sessionStore: SessionStore, apiClient: ApiClient) {
    super();
    this.sessionStore = sessionStore;
    this.apiClient = apiClient;
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.registerSubsystem(FESL_SUBSYSTEMS.FSYS, handleFsys);
    this.registerSubsystem(FESL_SUBSYSTEMS.ACCT, handleAcct);
    this.registerSubsystem(FESL_SUBSYSTEMS.SUBS, handleSubs);
    this.registerSubsystem(FESL_SUBSYSTEMS.DOBJ, handleDobj);
    this.registerSubsystem(FESL_SUBSYSTEMS.RANK, handleRank);
    this.registerSubsystem(FESL_SUBSYSTEMS.GSUM, handleGsum);
    this.registerSubsystem(FESL_SUBSYSTEMS.PNOW, handlePnow);
  }

  /**
   * Registers a handler for a specific 4-character FESL subsystem query.
   */
  public registerSubsystem(subsystem: string, handler: FeslCommandHandler): void {
    const key = subsystem.trim().toLowerCase();
    this.handlers.set(key, handler);
  }

  /**
   * Unregisters a subsystem handler.
   */
  public unregisterSubsystem(subsystem: string): void {
    const key = subsystem.trim().toLowerCase();
    this.handlers.delete(key);
  }

  /**
   * Dispatches an incoming packet to the appropriate subsystem handler.
   */
  public async handlePacket(connection: FeslConnection, packet: FeslPacket): Promise<void> {
    const subsystemKey = packet.subsystem.trim().toLowerCase();
    const handler = this.handlers.get(subsystemKey);
    const txn = getPacketTxn(packet);

    this.emit('packet', connection, packet);

    const ctx: FeslHandlerContext = {
      connection,
      packet,
      sessionStore: this.sessionStore,
      apiClient: this.apiClient,
    };

    if (!handler) {
      console.warn(`[FeslRouter] No handler registered for subsystem '${packet.subsystem}' (TXN: ${txn || 'none'})`);
      connection.sendError(
        packet.subsystem,
        packet.subtype,
        txn || 'Unknown',
        `Unknown subsystem: ${packet.subsystem}`,
        echoRequestTid({}, packet)
      );
      this.emit('handled', connection, packet);
      return;
    }

    console.log(`[FeslRouter] [${connection.id}] RECV ${packet.subsystem} (0x${packet.subtype.toString(16)}) TXN=${txn}:`, JSON.stringify(redactSensitive(packet.payload)));

    try {
      const result = await handler(ctx);

      if (!result) {
        this.emit('handled', connection, packet);
        return;
      }

      // If handler returned a payload object or packet
      const responseSubtype = (packet.subtype | 0x80000000) >>> 0;
      const responsePayload = echoRequestTid(
        'payload' in result && typeof result.payload === 'object'
          ? (result as FeslPacket).payload
          : (result as Record<string, any>),
        packet
      );

      console.log(`[FeslRouter] [${connection.id}] SEND ${packet.subsystem} (0x${responseSubtype.toString(16)}) TXN=${txn}:`, JSON.stringify(redactSensitive(responsePayload)));
      connection.sendPacket({
        subsystem: packet.subsystem,
        subtype: responseSubtype,
        payload: responsePayload,
      });

      this.emit('handled', connection, packet, responsePayload);
    } catch (err) {
      console.error(`[FeslRouter] Error handling ${packet.subsystem}.${txn || ''}: ${(err as Error).message}`, err);
      connection.sendError(
        packet.subsystem,
        packet.subtype,
        txn || 'Unknown',
        [{ fieldName: 'server', fieldError: (err as Error).message || 'Internal server error', fieldErrorCode: 5000 }],
        echoRequestTid({}, packet)
      );
      this.emit('error', err as Error, connection, packet);
    }
  }
}
