import { FeslPacket, FESL_TXN } from '@mohpa/shared';
import { FeslHandlerContext, getPacketArray, getPacketTxn } from '../types.js';

/**
 * Handles rank subsystem commands: GetStats, UpdateStats.
 */
export async function handleRank(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { packet } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.GET_STATS: {
      const requestedKeys = getPacketArray<string>(packet, 'keys');
      const statsList: Array<{ key: string; value: string }> = [];

      if (requestedKeys.length > 0) {
        for (const key of requestedKeys) {
          statsList.push({
            key: typeof key === 'string' ? key : (key as any).key || 'score',
            value: '0',
          });
        }
      } else {
        // Default standard ranking stats
        statsList.push(
          { key: 'score', value: '1000' },
          { key: 'rank', value: '1' },
          { key: 'kills', value: '25' },
          { key: 'deaths', value: '10' },
          { key: 'wins', value: '5' },
          { key: 'losses', value: '2' },
          { key: 'timePlayed', value: '3600' }
        );
      }

      return {
        TXN: FESL_TXN.GET_STATS,
        stats: statsList,
      };
    }

    case FESL_TXN.UPDATE_STATS: {
      return {
        TXN: FESL_TXN.UPDATE_STATS,
        status: 0,
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown rank command: ${txn}` },
        ],
      };
    }
  }
}
