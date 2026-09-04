import { FeslPacket } from '@centralspy/shared';
import { TheaterHandlerContext, getPacketString, getPacketNumber, getPacketTxn } from '../types.js';
import { config } from '../../config/config.js';

/**
 * Handles CONN subsystem command: authenticates Theater connection via FESL LKEY.
 */
export async function handleConn(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet, sessionStore } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const lkey = getPacketString(packet, 'LKEY') || getPacketString(packet, 'lkey');

  if (!lkey) {
    return {
      TID: tid,
      errorContainer: [
        { fieldName: 'LKEY', fieldError: 'Missing LKEY login token', fieldErrorCode: 2001 },
      ],
    };
  }

  const session = await sessionStore.getSession(lkey);
  if (!session) {
    return {
      TID: tid,
      errorContainer: [
        { fieldName: 'LKEY', fieldError: 'Invalid or expired LKEY session', fieldErrorCode: 2001 },
      ],
    };
  }

  connection.attachSession(session);

  const prot = getPacketNumber(packet, 'PROT', 2);
  const cid = session.personaId || session.userId || 1;

  return {
    TID: tid,
    TIME: Math.floor(Date.now() / 1000),
    activityTimeoutSecs: config.activityTimeoutSecs,
    PROT: prot,
    CID: cid,
    NAME: session.personaName || session.username || 'Player',
  };
}
