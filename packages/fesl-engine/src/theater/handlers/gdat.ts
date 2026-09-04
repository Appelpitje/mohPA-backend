import { FeslPacket } from '@centralspy/shared';
import {
  TheaterHandlerContext,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles GDAT subsystem command: returns detailed game server attributes & player list.
 */
export async function handleGdat(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const gid = getPacketNumber(packet, 'GID', 0);

  const game = lobbyManager.getGame(gid);
  if (!game) {
    return {
      TID: tid,
      errorContainer: [
        { fieldName: 'GID', fieldError: `Game session #${gid} not found`, fieldErrorCode: 4004 },
      ],
    };
  }

  const players = Array.from(game.players.values());

  const response: Record<string, any> = {
    TID: tid,
    GID: game.gid,
    LID: game.lid,
    NAME: `"${game.name}"`,
    IP: game.ip,
    PORT: game.port,
    'NUM-PLAYERS': game.currentPlayers,
    'MAX-PLAYERS': game.maxPlayers,
    TYPE: game.type,
  };

  // Add parameters
  if (game.params) {
    for (const [k, v] of Object.entries(game.params)) {
      response[k] = v;
    }
  }

  // Add player roster
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    response[`PLAYER.${i}.PID`] = p.pid;
    response[`PLAYER.${i}.NAME`] = `"${p.name}"`;
    response[`PLAYER.${i}.SLOT`] = p.slot;
    response[`PLAYER.${i}.TEAM`] = p.team;
    response[`PLAYER.${i}.SCORE`] = p.score;
    response[`PLAYER.${i}.PING`] = p.ping;
    response[`PLAYER.${i}.KILLS`] = p.kills;
    response[`PLAYER.${i}.DEATHS`] = p.deaths;
    response[`PLAYER.${i}.STATUS`] = p.status;
  }

  return response;
}
