import { FeslPacket } from '@mohpa/shared';
import {
  TheaterHandlerContext,
  getPacketString,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles KICK subsystem command: kicks player from game session and notifies connection.
 */
export async function handleKick(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const gid = getPacketNumber(packet, 'GID', 0);
  const pid = getPacketNumber(packet, 'PID', 0);
  const reason = getPacketString(packet, 'REASON', 'Kicked by host');

  const game = lobbyManager.getGame(gid);
  if (game) {
    const player = game.players.get(pid);
    if (player?.connection && !player.connection.socket.destroyed) {
      player.connection.sendPacket({
        subsystem: 'KICK',
        subtype: 0xc0000000,
        payload: {
          GID: gid,
          PID: pid,
          REASON: reason,
        },
      });
    }
  }

  const removed = lobbyManager.removePlayer(gid, pid, reason);

  return {
    TID: tid,
    GID: gid,
    PID: pid,
    SUCCESS: removed ? 1 : 0,
  };
}
