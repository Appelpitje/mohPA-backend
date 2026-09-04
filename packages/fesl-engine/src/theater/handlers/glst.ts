import { FeslPacket } from '@centralspy/shared';
import {
  TheaterHandlerContext,
  getPacketString,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles GLST subsystem command: returns game server list matching query filters.
 */
export async function handleGlst(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';

  const lidRaw = packet.payload.LID ?? packet.payload.lid;
  const lid = lidRaw !== undefined ? Number(lidRaw) : undefined;
  const name = getPacketString(packet, 'NAME');
  const maxGames = getPacketNumber(packet, 'MAX-GAMES', getPacketNumber(packet, 'COUNT', 50));
  const offset = getPacketNumber(packet, 'OFFSET', 0);
  const mapName = getPacketString(packet, 'MAPNAME') || getPacketString(packet, 'MAP');
  const gameMode = getPacketString(packet, 'GAMEMODE') || getPacketString(packet, 'MODE');
  const notFull = packet.payload['NOT-FULL'] === '1' || packet.payload['NOT-FULL'] === true;
  const notEmpty = packet.payload['NOT-EMPTY'] === '1' || packet.payload['NOT-EMPTY'] === true;

  const games = lobbyManager.listGames({
    lid: isNaN(Number(lid)) ? undefined : Number(lid),
    name: name && name !== '*' ? name : undefined,
    mapName: mapName || undefined,
    gameMode: gameMode || undefined,
    notFull,
    notEmpty,
    offset,
    limit: maxGames,
  });

  const response: Record<string, any> = {
    TID: tid,
    'NUM-GAMES': games.length,
  };

  if (games.length > 0) {
    const first = games[0];
    response.GID = first.gid;
    response.LID = first.lid;
    response.NAME = `"${first.name}"`;
    response.IP = first.ip;
    response.PORT = first.port;
    response['NUM-PLAYERS'] = first.currentPlayers;
    response['MAX-PLAYERS'] = first.maxPlayers;
    response.TYPE = first.type;

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      response[`${i}.GID`] = g.gid;
      response[`${i}.LID`] = g.lid;
      response[`${i}.NAME`] = `"${g.name}"`;
      response[`${i}.IP`] = g.ip;
      response[`${i}.PORT`] = g.port;
      response[`${i}.NUM-PLAYERS`] = g.currentPlayers;
      response[`${i}.MAX-PLAYERS`] = g.maxPlayers;
      response[`${i}.TYPE`] = g.type;

      // Add common game parameters
      if (g.params) {
        for (const [pk, pv] of Object.entries(g.params)) {
          response[`${i}.${pk}`] = pv;
        }
      }
    }
  }

  return response;
}
