import { FeslPacket } from '@mohpa/shared';
import { TheaterHandlerContext, getPacketNumber, getPacketTxn } from '../types.js';

/**
 * Handles USER subsystem command: resolves user details and permissions.
 */
export async function handleUser(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const cid = getPacketNumber(packet, 'CID', 1);

  const session = connection.session;
  const name = session?.personaName || session?.username || 'Player';
  const uid = session?.userId || 1;
  const pid = session?.personaId || 1;
  const type = connection.clientType || 'client';

  return {
    TID: tid,
    NAME: name,
    CID: cid,
    UID: uid,
    PID: pid,
    TYPE: type,
    PERM: 0,
  };
}
