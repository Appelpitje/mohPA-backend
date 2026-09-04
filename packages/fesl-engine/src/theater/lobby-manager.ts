import * as crypto from 'node:crypto';
import { ApiClient } from '../api-client/api-client.js';
import { FeslConnection } from '../network/connection.js';
import {
  TheaterLobby,
  TheaterPlayer,
  TheaterPlayerAttributes,
  TheaterGameSession,
  CreateGameParams,
  GameFilterParams,
  EnterGameParams,
  EnterGameResult,
} from './types.js';

export class LobbyManager {
  private lobbies = new Map<number, TheaterLobby>();
  private games = new Map<number, TheaterGameSession>();
  private playerToGame = new Map<number, number>();
  private connToGameHost = new Map<string, number>();
  private connToPlayer = new Map<string, { gid: number; pid: number }>();
  private nextGid = 1;
  private apiClient?: ApiClient;

  constructor(apiClient?: ApiClient) {
    this.apiClient = apiClient;
    this.initializeDefaultLobbies();
  }

  private initializeDefaultLobbies(): void {
    const defaultLobbies: TheaterLobby[] = [
      {
        lid: 1,
        name: 'Default Lobby',
        locale: 'en_US',
        maxGames: 1000,
        numGames: 0,
        pass: '',
      },
      {
        lid: 2,
        name: 'Community Servers',
        locale: 'en_US',
        maxGames: 1000,
        numGames: 0,
        pass: '',
      },
    ];

    for (const lobby of defaultLobbies) {
      this.lobbies.set(lobby.lid, lobby);
    }
  }

  /**
   * Registers a dedicated game server session (CGAM).
   */
  public async createGame(params: CreateGameParams): Promise<TheaterGameSession> {
    const gid = this.nextGid++;
    const lid = params.lid ?? 1;
    const ip = params.ip || params.hostConnection?.remoteAddress || '127.0.0.1';
    const port = params.port || 13200;
    const maxPlayers = params.maxPlayers ?? 64;
    const type = params.type || 'G';
    const gameSlug = params.gameSlug || params.hostConnection?.gameSlug || 'mohpa';
    const now = Date.now();

    const game: TheaterGameSession = {
      gid,
      lid,
      name: params.name || `CentralSpy Game Server #${gid}`,
      ip,
      port,
      queryPort: params.queryPort || port + 1000,
      maxPlayers,
      currentPlayers: 0,
      type,
      params: params.params || {},
      secretKey: params.secretKey,
      gameSlug,
      hostConnection: params.hostConnection,
      players: new Map<number, TheaterPlayer>(),
      createdAt: now,
      updatedAt: now,
    };

    this.games.set(gid, game);

    if (params.hostConnection) {
      this.connToGameHost.set(params.hostConnection.id, gid);
      params.hostConnection.customData.set('gid', gid);
    }

    this.updateLobbyCounts();

    // Async sync with api-service if available
    if (this.apiClient) {
      this.apiClient
        .registerGameServer({
          name: game.name,
          gameSlug,
          ipAddress: ip,
          port,
          queryPort: game.queryPort,
          isRanked: game.params.ranked !== '0' && game.params.ranked !== false,
          maxPlayers,
        })
        .then((reg) => {
          if (reg?.serverId) {
            game.serverId = reg.serverId;
            if (reg.secretKey) {
              game.secretKey = reg.secretKey;
            }
          }
        })
        .catch(() => {});
    }

    return game;
  }

  /**
   * Retrieves an active game session by GID.
   */
  public getGame(gid: number): TheaterGameSession | undefined {
    return this.games.get(gid);
  }

  /**
   * Lists active games matching the specified filter criteria.
   */
  public listGames(filter?: GameFilterParams): TheaterGameSession[] {
    let result: TheaterGameSession[] = Array.from(this.games.values());

    if (!filter) {
      return result;
    }

    if (filter.lid !== undefined) {
      result = result.filter((g) => g.lid === filter.lid);
    }

    if (filter.name) {
      const search = filter.name.toLowerCase().replace(/\*/g, '');
      result = result.filter((g) => g.name.toLowerCase().includes(search));
    }

    if (filter.gameSlug) {
      result = result.filter((g) => !g.gameSlug || g.gameSlug === filter.gameSlug);
    }

    if (filter.mapName) {
      const mapSearch = filter.mapName.toLowerCase();
      result = result.filter((g) => {
        const map = (g.params.mapName || g.params.map || '').toLowerCase();
        return map.includes(mapSearch);
      });
    }

    if (filter.gameMode) {
      const modeSearch = filter.gameMode.toLowerCase();
      result = result.filter((g) => {
        const mode = (g.params.gameMode || g.params.mode || '').toLowerCase();
        return mode.includes(modeSearch);
      });
    }

    if (filter.notFull) {
      result = result.filter((g) => g.currentPlayers < g.maxPlayers);
    }

    if (filter.notEmpty) {
      result = result.filter((g) => g.currentPlayers > 0);
    }

    const offset = filter.offset || 0;
    const limit = filter.limit || filter.maxGames || result.length;

    return result.slice(offset, offset + limit);
  }

  /**
   * Updates an existing game session's metadata or parameters.
   */
  public updateGame(
    gid: number,
    updates: Partial<TheaterGameSession>
  ): TheaterGameSession | undefined {
    const game = this.games.get(gid);
    if (!game) return undefined;

    if (updates.name !== undefined) game.name = updates.name;
    if (updates.maxPlayers !== undefined) game.maxPlayers = updates.maxPlayers;
    if (updates.currentPlayers !== undefined) game.currentPlayers = updates.currentPlayers;
    if (updates.ip !== undefined) game.ip = updates.ip;
    if (updates.port !== undefined) game.port = updates.port;
    if (updates.queryPort !== undefined) game.queryPort = updates.queryPort;
    if (updates.type !== undefined) game.type = updates.type;
    if (updates.hostConnection !== undefined) game.hostConnection = updates.hostConnection;

    if (updates.params) {
      game.params = { ...game.params, ...updates.params };
    }

    game.updatedAt = Date.now();

    // Async sync heartbeat with api-service if secretKey is available
    if (this.apiClient && game.secretKey) {
      this.apiClient
        .updateGameServerHeartbeat(game.secretKey, {
          name: game.name,
          currentPlayers: game.currentPlayers,
          maxPlayers: game.maxPlayers,
          mapName: game.params.mapName || game.params.map,
          gameMode: game.params.gameMode || game.params.mode,
          subState: game.params.subState,
          details: {
            rules: game.params,
            players: Array.from(game.players.values()).map((p) => ({
              pid: p.pid,
              name: p.name,
              score: p.score,
              kills: p.kills,
              deaths: p.deaths,
              ping: p.ping,
              team: p.team,
            })),
          },
        })
        .catch(() => {});
    }

    return game;
  }

  /**
   * Removes a game session and clears associated player mappings.
   */
  public removeGame(gid: number): boolean {
    const game = this.games.get(gid);
    if (!game) return false;

    // Disconnect and clear player mappings
    for (const [pid, player] of game.players.entries()) {
      this.playerToGame.delete(pid);
      if (player.connection) {
        this.connToPlayer.delete(player.connection.id);
      }
    }

    if (game.hostConnection) {
      this.connToGameHost.delete(game.hostConnection.id);
    }

    this.games.delete(gid);
    this.updateLobbyCounts();
    return true;
  }

  /**
   * Handles player entry into a game (EGAM), allocating slot and sending EGRQ/PENT to host.
   */
  public async enterGame(
    gid: number,
    playerConnection: FeslConnection,
    params?: EnterGameParams
  ): Promise<EnterGameResult> {
    const game = this.games.get(gid);
    if (!game) {
      throw new Error(`Game session #${gid} not found`);
    }

    if (game.currentPlayers >= game.maxPlayers) {
      throw new Error(`Game session #${gid} is full (${game.currentPlayers}/${game.maxPlayers})`);
    }

    const pid =
      params?.pid ||
      (playerConnection.session?.personaId
        ? Number(playerConnection.session.personaId)
        : playerConnection.session?.userId
        ? Number(playerConnection.session.userId) * 100 + 1
        : Math.floor(Math.random() * 90000) + 10000);

    const name =
      params?.name ||
      playerConnection.session?.personaName ||
      playerConnection.session?.username ||
      `Player_${pid}`;

    // If player is already in a game, remove them from previous session
    const existingGid = this.playerToGame.get(pid);
    if (existingGid !== undefined && existingGid !== gid) {
      this.removePlayer(existingGid, pid, 'switch_game');
    }

    // Allocate first available slot
    const takenSlots = new Set(Array.from(game.players.values()).map((p) => p.slot));
    let slot = 0;
    while (takenSlots.has(slot) && slot < game.maxPlayers) {
      slot++;
    }

    const ticket = params?.ticket || crypto.randomBytes(8).toString('hex');
    const now = Date.now();

    const player: TheaterPlayer = {
      pid,
      userId: playerConnection.session?.userId || pid,
      name,
      connection: playerConnection,
      slot,
      team: params?.team ?? 0,
      ping: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      status: params?.status || 'active',
      ticket,
      attrs: params?.params || {},
      joinedAt: now,
      lastActivityAt: now,
    };

    game.players.set(pid, player);
    game.currentPlayers = game.players.size;
    game.updatedAt = now;

    this.playerToGame.set(pid, gid);
    this.connToPlayer.set(playerConnection.id, { gid, pid });

    // If host dedicated server is connected, coordinate EGRQ (Enter Game Request) & PENT (Player Entered)
    if (game.hostConnection && !game.hostConnection.socket.destroyed) {
      // 1. Send EGRQ to game host
      game.hostConnection.sendPacket({
        subsystem: 'EGRQ',
        subtype: 0xc0000000,
        payload: {
          TID: 0,
          GID: gid,
          PID: pid,
          NAME: name,
          IP: playerConnection.remoteAddress,
          PORT: playerConnection.remotePort,
          TICKET: ticket,
          SLOT: slot,
          UID: player.userId,
        },
      });

      // 2. Send PENT notification to game host
      game.hostConnection.sendPacket({
        subsystem: 'PENT',
        subtype: 0xc0000000,
        payload: {
          GID: gid,
          PID: pid,
          NAME: name,
          SLOT: slot,
          TEAM: player.team,
          STATUS: player.status,
          IP: playerConnection.remoteAddress,
        },
      });
    }

    return {
      gid,
      lid: game.lid,
      name: game.name,
      ip: game.ip,
      port: game.port,
      ticket,
      slot,
      pid,
      params: game.params,
    };
  }

  /**
   * Updates player attributes in a game lobby (score, kills, ping, team, status).
   */
  public updatePlayerAttributes(
    gid: number,
    pid: number,
    attrs: Partial<TheaterPlayerAttributes>
  ): boolean {
    const game = this.games.get(gid);
    if (!game) return false;

    const player = game.players.get(pid);
    if (!player) return false;

    if (attrs.score !== undefined) player.score = attrs.score;
    if (attrs.kills !== undefined) player.kills = attrs.kills;
    if (attrs.deaths !== undefined) player.deaths = attrs.deaths;
    if (attrs.ping !== undefined) player.ping = attrs.ping;
    if (attrs.team !== undefined) player.team = attrs.team;
    if (attrs.status !== undefined) player.status = attrs.status;

    player.attrs = { ...player.attrs, ...attrs };
    player.lastActivityAt = Date.now();
    game.updatedAt = Date.now();

    return true;
  }

  /**
   * Removes a player from an active game session.
   */
  public removePlayer(gid: number, pid: number, reason?: string): boolean {
    const game = this.games.get(gid);
    if (!game) return false;

    const player = game.players.get(pid);
    if (!player) return false;

    game.players.delete(pid);
    game.currentPlayers = game.players.size;
    game.updatedAt = Date.now();

    this.playerToGame.delete(pid);
    if (player.connection) {
      this.connToPlayer.delete(player.connection.id);
    }

    // Notify dedicated host of player leave
    if (game.hostConnection && !game.hostConnection.socket.destroyed) {
      game.hostConnection.sendPacket({
        subsystem: 'PLFT',
        subtype: 0xc0000000,
        payload: {
          GID: gid,
          PID: pid,
          REASON: reason || 'leave',
        },
      });
    }

    return true;
  }

  /**
   * Finds which game session a player is currently in.
   */
  public findPlayerGame(pid: number): TheaterGameSession | undefined {
    const gid = this.playerToGame.get(pid);
    return gid !== undefined ? this.games.get(gid) : undefined;
  }

  /**
   * Returns all available lobbies.
   */
  public getLobbies(): TheaterLobby[] {
    return Array.from(this.lobbies.values());
  }

  /**
   * Returns a specific lobby by LID.
   */
  public getLobby(lid: number): TheaterLobby | undefined {
    return this.lobbies.get(lid);
  }

  /**
   * Cleans up state when a TCP connection drops.
   */
  public handleDisconnect(connection: FeslConnection): void {
    // Check if disconnecting socket was a dedicated server host
    const hostedGid = this.connToGameHost.get(connection.id);
    if (hostedGid !== undefined) {
      console.log(`[LobbyManager] Dedicated server disconnected: removing game #${hostedGid}`);
      this.removeGame(hostedGid);
    }

    // Check if disconnecting socket was a player in a game
    const playerInfo = this.connToPlayer.get(connection.id);
    if (playerInfo) {
      this.removePlayer(playerInfo.gid, playerInfo.pid, 'disconnect');
    }
  }

  private updateLobbyCounts(): void {
    for (const lobby of this.lobbies.values()) {
      let count = 0;
      for (const game of this.games.values()) {
        if (game.lid === lobby.lid) {
          count++;
        }
      }
      lobby.numGames = count;
    }
  }

  /**
   * Clears all games and state (useful for teardown and tests).
   */
  public clear(): void {
    this.games.clear();
    this.playerToGame.clear();
    this.connToGameHost.clear();
    this.connToPlayer.clear();
    this.nextGid = 1;
    this.updateLobbyCounts();
  }
}
