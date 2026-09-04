import { FeslPacket } from '@centralspy/shared';
import {
  TheaterHandlerContext,
  getPacketString,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles UPLA subsystem command: updates player attributes in an active game session.
 */
export async function handleUpla(
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

  const score = packet.payload.SCORE !== undefined ? Number(packet.payload.SCORE) : undefined;
  const kills = packet.payload.KILLS !== undefined ? Number(packet.payload.KILLS) : undefined;
  const deaths = packet.payload.DEATHS !== undefined ? Number(packet.payload.DEATHS) : undefined;
  const ping = packet.payload.PING !== undefined ? Number(packet.payload.PING) : undefined;
  const team = packet.payload.TEAM !== undefined ? Number(packet.payload.TEAM) : undefined;
  const status = getPacketString(packet, 'STATUS');

  const updated = lobbyManager.updatePlayerAttributes(gid, pid, {
    score,
    kills,
    deaths,
    ping,
    team,
    status: status || undefined,
  });

  if (!updated) {
    return {
      TID: tid,
      errorContainer: [
        {
          fieldName: 'PID',
          fieldError: `Player #${pid} not found in game #${gid}`,
          fieldErrorCode: 4004,
        },
      ],
    };
  }

  return {
    TID: tid,
    GID: gid,
    PID: pid,
    SUCCESS: 1,
  };
}
