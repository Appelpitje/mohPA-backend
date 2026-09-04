import { FeslPacket } from '@centralspy/shared';
import { FeslConnection } from '../network/connection.js';
import { SessionStore } from '../session/types.js';
import { ApiClient } from '../api-client/api-client.js';

export interface FeslHandlerContext {
  connection: FeslConnection;
  packet: FeslPacket;
  sessionStore: SessionStore;
  apiClient: ApiClient;
}

export type FeslCommandHandler = (ctx: FeslHandlerContext) => Promise<void | FeslPacket | Record<string, any>>;

export interface FeslSubsystemHandler {
  subsystem: string;
  handle(ctx: FeslHandlerContext): Promise<void | FeslPacket | Record<string, any>>;
}

/**
 * Extracts TXN string from packet payload.
 */
export function getPacketTxn(packet: FeslPacket): string | undefined {
  return packet.payload.TXN || packet.payload.txn;
}

/**
 * Retrieves a string field from packet payload.
 */
export function getPacketString(packet: FeslPacket, key: string, defaultValue = ''): string {
  const val = packet.payload[key];
  if (val === undefined || val === null) return defaultValue;
  return String(val);
}

/**
 * Retrieves a numeric field from packet payload.
 */
export function getPacketNumber(packet: FeslPacket, key: string, defaultValue = 0): number {
  const val = packet.payload[key];
  if (val === undefined || val === null) return defaultValue;
  const num = Number(val);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Extracts an array of items with the given prefix from packet payload.
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
