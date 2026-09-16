import { FeslPacket, FESL_TXN } from '@mohpa/shared';
import { FeslHandlerContext, getPacketNumber, getPacketString, getPacketTxn } from '../types.js';
import { config } from '../../config/config.js';

/**
 * Handles pnow (Play Now / Matchmaking) subsystem commands: Start, Status.
 */
export async function handlePnow(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { packet } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.START: {
      const partition = getPacketString(packet, 'partition', 'pnow');
      const ticketId = getPacketNumber(packet, 'id.id', 1);

      return {
        TXN: FESL_TXN.START,
        'id.id': ticketId,
        'id.partition': partition,
        status: 'MATCH_FOUND',
        theaterHost: config.theaterHost,
        theaterPort: config.theaterClientPort,
        fit: 1000,
      };
    }

    case FESL_TXN.STATUS: {
      const partition = getPacketString(packet, 'id.partition', 'pnow');
      const ticketId = getPacketNumber(packet, 'id.id', 1);

      return {
        TXN: FESL_TXN.STATUS,
        'id.id': ticketId,
        'id.partition': partition,
        status: 'MATCH_FOUND',
        theaterHost: config.theaterHost,
        theaterPort: config.theaterClientPort,
        fit: 1000,
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown pnow command: ${txn}` },
        ],
      };
    }
  }
}
