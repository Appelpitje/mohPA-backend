import { parseKvPayload, formatKvPayload } from './kv-serializer.js';

export interface FeslPacketOptions {
  subsystem: string;
  packetType: number;
  payload?: Record<string, any> | string;
  rawPayload?: string;
  length?: number;
}

export class FeslPacket {
  public subsystem: string;
  public packetType: number;
  public payload: Record<string, any>;
  public rawPayload: string;
  public length: number;

  constructor(options: FeslPacketOptions) {
    // Subsystem must be exactly 4 ASCII characters (padded with spaces if shorter)
    this.subsystem = (options.subsystem || 'fsys').padEnd(4, ' ').substring(0, 4);
    this.packetType = options.packetType >>> 0; // ensure uint32

    if (typeof options.payload === 'string') {
      this.rawPayload = options.payload;
      this.payload = parseKvPayload(options.payload);
    } else if (options.payload) {
      this.payload = options.payload;
      this.rawPayload = options.rawPayload || formatKvPayload(options.payload);
    } else if (options.rawPayload) {
      this.rawPayload = options.rawPayload;
      this.payload = parseKvPayload(options.rawPayload);
    } else {
      this.payload = {};
      this.rawPayload = '';
    }

    const payloadBytes = Buffer.byteLength(this.rawPayload, 'utf8');
    this.length = options.length ?? 12 + payloadBytes;
  }

  /**
   * Returns the command transaction name (TXN) if present in payload.
   */
  public get txn(): string | undefined {
    return this.payload.TXN || this.payload.txn;
  }

  /**
   * Retrieves a string field from the payload.
   */
  public getString(key: string, defaultValue = ''): string {
    const val = this.payload[key];
    if (val === undefined || val === null) return defaultValue;
    return String(val);
  }

  /**
   * Retrieves a numeric field from the payload.
   */
  public getNumber(key: string, defaultValue = 0): number {
    const val = this.payload[key];
    if (val === undefined || val === null) return defaultValue;
    const parsed = Number(val);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Retrieves a boolean field from the payload.
   */
  public getBoolean(key: string, defaultValue = false): boolean {
    const val = this.payload[key];
    if (val === undefined || val === null) return defaultValue;
    if (typeof val === 'boolean') return val;
    const str = String(val).toLowerCase();
    return str === '1' || str === 'true' || str === 'yes';
  }

  /**
   * Extracts an array of items with the given prefix (e.g. `personas`, `pingSites`).
   */
  public getArray<T = any>(prefix: string): T[] {
    const countKey = `${prefix}.[]`;
    const countVal = this.payload[countKey];
    const items: T[] = [];

    if (countVal !== undefined) {
      const count = parseInt(countVal, 10);
      for (let i = 0; i < count; i++) {
        const itemKey = `${prefix}.${i}`;
        if (itemKey in this.payload) {
          items.push(this.payload[itemKey] as unknown as T);
        } else {
          // Check for sub-keys like prefix.0.name
          const obj: Record<string, any> = {};
          let foundSub = false;
          const subPrefix = `${itemKey}.`;
          for (const [k, v] of Object.entries(this.payload)) {
            if (k.startsWith(subPrefix)) {
              obj[k.substring(subPrefix.length)] = v;
              foundSub = true;
            }
          }
          if (foundSub) {
            items.push(obj as unknown as T);
          }
        }
      }
      return items;
    }

    // If no count indicator, search sequentially
    let idx = 0;
    while (true) {
      const itemKey = `${prefix}.${idx}`;
      if (itemKey in this.payload) {
        items.push(this.payload[itemKey] as unknown as T);
      } else {
        const obj: Record<string, any> = {};
        let foundSub = false;
        const subPrefix = `${itemKey}.`;
        for (const [k, v] of Object.entries(this.payload)) {
          if (k.startsWith(subPrefix)) {
            obj[k.substring(subPrefix.length)] = v;
            foundSub = true;
          }
        }
        if (foundSub) {
          items.push(obj as unknown as T);
        } else {
          break;
        }
      }
      idx++;
    }

    return items;
  }

  /**
   * Factory method to create a response packet to a request packet.
   */
  public static createResponse(
    subsystem: string,
    requestPacketType: number,
    payload: Record<string, any>
  ): FeslPacket {
    // In EA FESL, response packetType sets the 0x80000000 bit or preserves subtype
    const responseType = (requestPacketType | 0x80000000) >>> 0;
    const rawPayload = formatKvPayload(payload);
    return new FeslPacket({
      subsystem,
      packetType: responseType,
      payload,
      rawPayload,
    });
  }

  /**
   * Factory method to create a standard error container response packet.
   */
  public static createError(
    subsystem: string,
    requestPacketType: number,
    txn: string,
    errorDetails: Array<{ fieldName: string; fieldError: string; fieldErrorCode?: number | string }> | string
  ): FeslPacket {
    const errorContainer = typeof errorDetails === 'string'
      ? [{ fieldName: 'error', fieldError: errorDetails }]
      : errorDetails;

    const payload: Record<string, any> = {
      TXN: txn,
      errorContainer,
    };

    return FeslPacket.createResponse(subsystem, requestPacketType, payload);
  }
}
