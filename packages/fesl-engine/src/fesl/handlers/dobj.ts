import { FeslPacket, FESL_TXN } from '@mohpa/shared';
import { FeslHandlerContext, getPacketTxn } from '../types.js';

/**
 * Handles dobj (digital objects & inventory) subsystem commands: GetObjectInventory.
 */
export async function handleDobj(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { packet } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.GET_OBJECT_INVENTORY: {
      return {
        TXN: FESL_TXN.GET_OBJECT_INVENTORY,
        inventory: [],
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown dobj command: ${txn}` },
        ],
      };
    }
  }
}
