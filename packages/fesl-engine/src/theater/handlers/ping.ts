import { FeslPacket } from '@mohpa/shared';
import { TheaterHandlerContext, getPacketTxn, getPacketString } from '../types.js';

/**
 * Handles PING subsystem command: keep-alive / latency probe.
 */
export async function handlePing(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { packet } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const clientTime = getPacketString(packet, 'CLIENT-TIME') || getPacketString(packet, 'TIME');

  const response: Record<string, any> = {
    TID: tid,
    TIME: Math.floor(Date.now() / 1000),
  };

  if (clientTime) {
    response['CLIENT-TIME'] = clientTime;
  }

  return response;
}
