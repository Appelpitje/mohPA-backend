import { FeslPacket } from '@mohpa/shared';
import {
  TheaterHandlerContext,
  getPacketString,
  getPacketNumber,
  getPacketTxn,
} from '../types.js';

/**
 * Handles CGAM subsystem command: registers a dedicated game server session.
 */
export async function handleCgam(
  ctx: TheaterHandlerContext
): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet, lobbyManager } = ctx;
  const tid = getPacketTxn(packet) || '1';

  const lid = getPacketNumber(packet, 'LID', 1);
  const name =
    getPacketString(packet, 'NAME') ||
    connection.session?.personaName ||
    connection.session?.username ||
    `Game Server ${connection.remoteAddress}`;
  const ip = getPacketString(packet, 'IP') || connection.remoteAddress;
  const port = getPacketNumber(packet, 'PORT', 16567);
  const queryPort = getPacketNumber(packet, 'QPORT', getPacketNumber(packet, 'QUERYPORT', port + 1000));
  const maxPlayers = getPacketNumber(packet, 'MAX-PLAYERS', 64);
  const type = getPacketString(packet, 'TYPE', 'G');
  const secretKey = getPacketString(packet, 'SECRETKEY') || getPacketString(packet, 'SECRET');

  // Extract custom game server parameters from packet payload
  const params: Record<string, any> = {};
  const ignoredKeys = new Set([
    'TID',
    'tid',
    'TXN',
    'txn',
    'LID',
    'lid',
    'NAME',
    'name',
    'IP',
    'ip',
    'PORT',
    'port',
    'QPORT',
    'QUERYPORT',
    'MAX-PLAYERS',
    'maxPlayers',
    'TYPE',
    'type',
    'SECRETKEY',
    'SECRET',
  ]);

  for (const [k, v] of Object.entries(packet.payload)) {
    if (!ignoredKeys.has(k)) {
      params[k] = v;
    }
  }

  const game = await lobbyManager.createGame({
    lid,
    name,
    ip,
    port,
    queryPort,
    maxPlayers,
    type,
    params,
    secretKey: secretKey || undefined,
    hostConnection: connection,
  });

  return {
    TID: tid,
    GID: game.gid,
    LID: game.lid,
    'MAX-PLAYERS': game.maxPlayers,
    'NUM-PLAYERS': 0,
    IP: game.ip,
    PORT: game.port,
    TYPE: game.type,
  };
}
