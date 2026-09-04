import { FeslPacket } from '@centralspy/shared';
import { TheaterHandlerContext, getPacketTxn } from '../types.js';

/**
 * Handles LLST subsystem command: returns lobby list.
 */
export async function handleLlst(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';
  const lobbies = lobbyManager.getLobbies();

  const response: Record<string, any> = {
    TID: tid,
    'NUM-LOBBIES': lobbies.length,
  };

  if (lobbies.length > 0) {
    const first = lobbies[0];
    response.LID = first.lid;
    response.PASS = first.pass || '';
    response.NAME = `"${first.name}"`;
    response.LOCALE = first.locale;
    response['MAX-GAMES'] = first.maxGames;
    response['NUM-GAMES'] = first.numGames;

    for (let i = 0; i < lobbies.length; i++) {
      const lobby = lobbies[i];
      response[`${i}.LID`] = lobby.lid;
      response[`${i}.PASS`] = lobby.pass || '';
      response[`${i}.NAME`] = `"${lobby.name}"`;
      response[`${i}.LOCALE`] = lobby.locale;
      response[`${i}.MAX-GAMES`] = lobby.maxGames;
      response[`${i}.NUM-GAMES`] = lobby.numGames;
    }
  }

  return response;
}
