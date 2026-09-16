import { FeslPacket } from '@mohpa/shared';
import { FeslConnection } from '../network/connection.js';
import { SessionStore } from '../session/types.js';
import { ApiClient } from '../api-client/api-client.js';
import type { LobbyManager } from './lobby-manager.js';

export interface TheaterLobby {
  lid: number;
  name: string;
  locale: string;
  maxGames: number;
  numGames: number;
  pass?: string;
  gameSlug?: string;
}

export interface TheaterPlayer {
  pid: number;
  userId: string | number;
  name: string;
  connection?: FeslConnection;
  slot: number;
  team: number;
  ping: number;
  score: number;
  kills: number;
  deaths: number;
  status: string;
  ticket?: string;
  attrs: Record<string, any>;
  joinedAt: number;
  lastActivityAt: number;
}

export interface TheaterPlayerAttributes {
  score?: number;
  kills?: number;
  deaths?: number;
  ping?: number;
  team?: number;
  status?: string;
  rank?: number;
  [key: string]: any;
}

export interface TheaterGameSession {
  gid: number;
  lid: number;
  name: string;
  ip: string;
  port: number;
  queryPort?: number;
  maxPlayers: number;
  currentPlayers: number;
  type: string;
  params: Record<string, any>;
  secretKey?: string;
  serverId?: string;
  gameSlug?: string;
  hostConnection?: FeslConnection;
  players: Map<number, TheaterPlayer>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateGameParams {
  lid?: number;
  name: string;
  ip?: string;
  port: number;
  queryPort?: number;
  maxPlayers?: number;
  type?: string;
  params?: Record<string, any>;
  secretKey?: string;
  hostConnection?: FeslConnection;
  gameSlug?: string;
}

export interface GameFilterParams {
  lid?: number;
  name?: string;
  gameSlug?: string;
  mapName?: string;
  gameMode?: string;
  notFull?: boolean;
  notEmpty?: boolean;
  offset?: number;
  limit?: number;
  maxGames?: number;
}

export interface EnterGameParams {
  pid?: number;
  name?: string;
  ticket?: string;
  team?: number;
  status?: string;
  params?: Record<string, any>;
}

export interface EnterGameResult {
  gid: number;
  lid: number;
  name: string;
  ip: string;
  port: number;
  ticket: string;
  slot: number;
  pid: number;
  params?: Record<string, any>;
}

export interface TheaterHandlerContext {
  connection: FeslConnection;
  packet: FeslPacket;
  sessionStore: SessionStore;
  apiClient: ApiClient;
  lobbyManager: LobbyManager;
}

export type TheaterCommandHandler = (
  ctx: TheaterHandlerContext
) => Promise<void | FeslPacket | Record<string, any>>;

export interface TheaterSubsystemHandler {
  subsystem: string;
  handle(ctx: TheaterHandlerContext): Promise<void | FeslPacket | Record<string, any>>;
}

/**
 * Extracts TXN or TID string from packet payload.
 */
export function getPacketTxn(packet: FeslPacket): string | undefined {
  const val = packet.payload.TID ?? packet.payload.tid ?? packet.payload.TXN ?? packet.payload.txn;
  return val !== undefined && val !== null ? String(val) : undefined;
}

/**
 * Retrieves a string field from packet payload.
 */
export function getPacketString(packet: FeslPacket, key: string, defaultValue = ''): string {
  const val = packet.payload[key];
  if (val === undefined || val === null) {
    // Also check case-insensitive or hyphen vs underscore variations
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(packet.payload)) {
      if (k.toLowerCase() === lowerKey || k.replace(/-/g, '_').toLowerCase() === lowerKey.replace(/-/g, '_')) {
        return String(v);
      }
    }
    return defaultValue;
  }
  return String(val);
}

/**
 * Retrieves a numeric field from packet payload.
 */
export function getPacketNumber(packet: FeslPacket, key: string, defaultValue = 0): number {
  const val = packet.payload[key];
  if (val === undefined || val === null) {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(packet.payload)) {
      if (k.toLowerCase() === lowerKey || k.replace(/-/g, '_').toLowerCase() === lowerKey.replace(/-/g, '_')) {
        const num = Number(v);
        return isNaN(num) ? defaultValue : num;
      }
    }
    return defaultValue;
  }
  const num = Number(val);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Extracts array of items from packet payload.
 */
export function getPacketArray<T = any>(packet: FeslPacket, prefix: string): T[] {
  const countKey = `${prefix}.[]`;
  const countVal = packet.payload[countKey];
  const items: T[] = [];

  if (countVal !== undefined) {
    const count = parseInt(countVal, 10);
    for (let i = 0; i < count; i++) {
      const itemKey = `${prefix}.${i}`;
      if (itemKey in packet.payload) {
        items.push(packet.payload[itemKey] as unknown as T);
      } else {
        const obj: Record<string, any> = {};
        let foundSub = false;
        const subPrefix = `${itemKey}.`;
        for (const [k, v] of Object.entries(packet.payload)) {
          if (k.startsWith(subPrefix)) {
            obj[k.substring(subPrefix.length)] = v;
            foundSub = true;
          }
        }
        if (foundSub) items.push(obj as unknown as T);
      }
    }
    return items;
  }

  let idx = 0;
  while (true) {
    const itemKey = `${prefix}.${idx}`;
    if (itemKey in packet.payload) {
      items.push(packet.payload[itemKey] as unknown as T);
    } else {
      const obj: Record<string, any> = {};
      let foundSub = false;
      const subPrefix = `${itemKey}.`;
      for (const [k, v] of Object.entries(packet.payload)) {
        if (k.startsWith(subPrefix)) {
          obj[k.substring(subPrefix.length)] = v;
          foundSub = true;
        }
      }
      if (foundSub) items.push(obj as unknown as T);
      else break;
    }
    idx++;
  }

  return items;
}
