import { formatFeslDate, FeslPacket, FESL_TXN, getGameConfig } from '@centralspy/shared';
import { FeslHandlerContext, getPacketString, getPacketNumber, getPacketTxn } from '../types.js';
import { config } from '../../config/config.js';

/**
 * Handles fsys subsystem commands: Hello, Ping, MemCheck, GetPingSites, Goodbye.
 */
export async function handleFsys(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.HELLO: {
      const clientType = getPacketString(packet, 'clientType', 'client');
      const sku = getPacketString(packet, 'sku', '');
      const locale = getPacketString(packet, 'locale', 'en_US');
      const domainPartition = getPacketString(packet, 'domainPartition.name', config.defaultDomainPartition);

      connection.clientType = clientType;
      connection.sku = sku;
      connection.locale = locale;
      connection.domainPartition = domainPartition;
      const game = getGameConfig(sku) || getGameConfig(domainPartition);
      connection.gameSlug = game?.slug || 'mohpa';

      const isServer = clientType === 'server' || clientType === 'dedicated';
      const theaterPort = isServer ? config.theaterServerPort : config.theaterClientPort;

      return {
        TXN: FESL_TXN.HELLO,
        'domainPartition.name': domainPartition,
        'domainPartition.subHost': config.publicIp,
        curTime: `"${formatFeslDate(new Date())}"`,
        activityTimeoutSecs: config.activityTimeoutSecs,
        theaterHost: config.theaterHost,
        theaterIp: config.publicIp,
        theaterPort,
        messengerHost: config.messengerHost,
        messengerIp: config.publicIp,
        messengerPort: config.messengerPort,
      };
    }

    case FESL_TXN.PING: {
      const tid = getPacketString(packet, 'TID');
      const response: Record<string, any> = {
        TXN: FESL_TXN.PING,
      };
      if (tid) {
        response.TID = tid;
      }
      return response;
    }

    case FESL_TXN.MEM_CHECK: {
      const type = getPacketNumber(packet, 'type', 0);
      const salt = getPacketString(packet, 'salt', '0');
      return {
        TXN: FESL_TXN.MEM_CHECK,
        type,
        salt,
        result: 0,
      };
    }

    case FESL_TXN.GET_PING_SITES: {
      return {
        TXN: FESL_TXN.GET_PING_SITES,
        minPingSitesToPing: 1,
        pingSites: [
          {
            addr: config.publicIp,
            port: config.feslClientPort,
            name: 'Local CentralSpy Gateway',
            type: 0,
          },
        ],
      };
    }

    case FESL_TXN.GOODBYE: {
      setTimeout(() => connection.close('Client requested Goodbye'), 50);
      return {
        TXN: FESL_TXN.GOODBYE,
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown fsys command: ${txn}` },
        ],
      };
    }
  }
}
