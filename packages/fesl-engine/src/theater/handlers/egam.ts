import { FeslPacket } from '@centralspy/shared';
import {
  TheaterHandlerContext,
  getPacketString,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles EGAM subsystem command: handles client game entry requests.
 */
export async function handleEgam(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const gid = getPacketNumber(packet, 'GID', 0);
  const pid = getPacketNumber(
    packet,
    'PID',
    connection.session?.personaId
      ? Number(connection.session.personaId)
      : connection.session?.userId
      ? Number(connection.session.userId) * 100 + 1
      : 0
  );
  const name =
    getPacketString(packet, 'NAME') ||
    connection.session?.personaName ||
    connection.session?.username;
  const team = getPacketNumber(packet, 'TEAM', 0);
  const ticket = getPacketString(packet, 'TICKET');

  try {
    const result = await lobbyManager.enterGame(gid, connection, {
      pid: pid || undefined,
      name: name || undefined,
      team,
      ticket: ticket || undefined,
    });

    return {
      TID: tid,
      GID: result.gid,
      LID: result.lid,
      IP: result.ip,
      PORT: result.port,
      TICKET: result.ticket,
      SLOT: result.slot,
      PID: result.pid,
      NAME: `"${result.name}"`,
    };
  } catch (err) {
    return {
      TID: tid,
      errorContainer: [
        {
          fieldName: 'GID',
          fieldError: (err as Error).message || 'Failed to enter game session',
          fieldErrorCode: 4005,
        },
      ],
    };
  }
}
