import { formatFeslDate, FeslPacket, FESL_TXN } from '@mohpa/shared';
import { FeslHandlerContext, getPacketNumber, getPacketTxn } from '../types.js';

/**
 * Handles subs (subscriptions & entitlements) subsystem commands: GetEntitlementByBundle.
 */
export async function handleSubs(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { packet } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.GET_ENTITLEMENT_BY_BUNDLE: {
      const bundleId = getPacketNumber(packet, 'bundleId', 1);
      return {
        TXN: FESL_TXN.GET_ENTITLEMENT_BY_BUNDLE,
        entitlements: [
          {
            entitlementId: 1,
            bundleId,
            status: 'ACTIVE',
            grantDate: `"${formatFeslDate(new Date())}"`,
          },
        ],
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown subs command: ${txn}` },
        ],
      };
    }
  }
}
