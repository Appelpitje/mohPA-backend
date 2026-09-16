import * as crypto from 'node:crypto';
import { FeslPacket, FESL_TXN } from '@mohpa/shared';
import { FeslHandlerContext, getPacketString, getPacketTxn } from '../types.js';

/**
 * Handles gsum (game summary & match reports) subsystem commands: GetSessionID, GetGameSummary.
 */
export async function handleGsum(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { packet } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.GET_SESSION_ID: {
      const sessionId = crypto.randomUUID();
      return {
        TXN: FESL_TXN.GET_SESSION_ID,
        sessionId,
      };
    }

    case FESL_TXN.GET_GAME_SUMMARY: {
      const gameId = getPacketString(packet, 'gameId', '1');
      return {
        TXN: FESL_TXN.GET_GAME_SUMMARY,
        gameId,
        summary: 'completed',
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown gsum command: ${txn}` },
        ],
      };
    }
  }
}
