import { FeslPacket } from '@centralspy/shared';
import {
  TheaterHandlerContext,
  getPacketString,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles ECNL subsystem command: cancels entry or leaves active game session.
 */
export async function handleEcnl(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const gid = getPacketNumber(packet, 'GID', 0);
  const pid = getPacketNumber(
    packet,
    'PID',
    connection.session?.personaId ? Number(connection.session.personaId) : 0
  );
  const reason = getPacketString(packet, 'REASON', 'User cancelled');

  const removed = lobbyManager.removePlayer(gid, pid, reason);

  return {
    TID: tid,
    GID: gid,
    PID: pid,
    SUCCESS: removed ? 1 : 0,
  };
}
