import { describe, it, expect, beforeEach } from 'vitest';
import * as net from 'node:net';
import { LobbyManager } from '../src/theater/lobby-manager.js';
import { FeslConnection } from '../src/network/connection.js';

describe('LobbyManager Game & Lobby Coordination', () => {
  let lobbyManager: LobbyManager;
  let mockSocket1: net.Socket;
  let mockSocket2: net.Socket;
  let hostConn: FeslConnection;
  let clientConn: FeslConnection;
  let hostSentPackets: any[];
  let clientSentPackets: any[];

  beforeEach(() => {
    lobbyManager = new LobbyManager();

    hostSentPackets = [];
    mockSocket1 = new net.Socket();
    mockSocket1.write = (chunk: any) => {
      hostSentPackets.push(chunk);
      return true;
    };

    hostConn = new FeslConnection({
      id: 'conn_host_1',
      socket: mockSocket1,
      serverPort: 18056,
      isTls: false,
    });

    clientSentPackets = [];
    mockSocket2 = new net.Socket();
    mockSocket2.write = (chunk: any) => {
      clientSentPackets.push(chunk);
      return true;
    };

    clientConn = new FeslConnection({
      id: 'conn_client_1',
      socket: mockSocket2,
      serverPort: 18275,
      isTls: false,
    });
  });

  it('initializes default lobbies correctly', () => {
    const lobbies = lobbyManager.getLobbies();
    expect(lobbies.length).toBeGreaterThanOrEqual(1);
    expect(lobbies[0].lid).toBe(1);
    expect(lobbies[0].name).toBe('Default Lobby');
  });

  it('creates and retrieves a game session (CGAM)', async () => {
    const game = await lobbyManager.createGame({
      lid: 1,
      name: 'Titan Defense 24/7',
      ip: '192.168.1.100',
      port: 16567,
      maxPlayers: 48,
      params: { mapName: 'Minsk', gameMode: 'Titan', ranked: '1' },
      hostConnection: hostConn,
    });

    expect(game.gid).toBeDefined();
    expect(game.name).toBe('Titan Defense 24/7');
    expect(game.maxPlayers).toBe(48);
    expect(game.currentPlayers).toBe(0);

    const retrieved = lobbyManager.getGame(game.gid);
    expect(retrieved).toBeDefined();
    expect(retrieved?.gid).toBe(game.gid);

    const lobby = lobbyManager.getLobby(1);
    expect(lobby?.numGames).toBe(1);
  });

  it('filters and paginates game list (GLST)', async () => {
    await lobbyManager.createGame({
      name: 'Server Alpha',
      port: 16567,
      params: { mapName: 'Minsk', gameMode: 'Conquest' },
    });
    await lobbyManager.createGame({
      name: 'Server Bravo',
      port: 16568,
      params: { mapName: 'Suez Canal', gameMode: 'Titan' },
    });
    await lobbyManager.createGame({
      name: 'Server Charlie',
      port: 16569,
      params: { mapName: 'Minsk', gameMode: 'Titan' },
    });

    // Filter by name
    const alphaList = lobbyManager.listGames({ name: 'Alpha' });
    expect(alphaList.length).toBe(1);
    expect(alphaList[0].name).toBe('Server Alpha');

    // Filter by mapName
    const minskList = lobbyManager.listGames({ mapName: 'Minsk' });
    expect(minskList.length).toBe(2);

    // Filter by gameMode
    const titanList = lobbyManager.listGames({ gameMode: 'Titan' });
    expect(titanList.length).toBe(2);

    // Pagination
    const page = lobbyManager.listGames({ offset: 1, limit: 1 });
    expect(page.length).toBe(1);
  });

  it('handles player game entry (EGAM), sends EGRQ/PENT to host', async () => {
    const game = await lobbyManager.createGame({
      lid: 1,
      name: 'Strike at Karkand 64',
      port: 16567,
      maxPlayers: 32,
      hostConnection: hostConn,
    });

    clientConn.attachSession({
      lkey: 'test_token',
      userId: 42,
      personaId: 4201,
      username: 'Soldier42',
      personaName: 'GeneralVanguard',
      clientType: 'client',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    });

    const entry = await lobbyManager.enterGame(game.gid, clientConn, {
      pid: 4201,
      name: 'GeneralVanguard',
      team: 1,
    });

    expect(entry.gid).toBe(game.gid);
    expect(entry.ticket).toBeDefined();
    expect(entry.slot).toBe(0);
    expect(entry.pid).toBe(4201);

    expect(game.currentPlayers).toBe(1);
    expect(game.players.has(4201)).toBe(true);

    // Host should have received EGRQ and PENT packets
    expect(hostSentPackets.length).toBeGreaterThanOrEqual(2);

    // Player game lookup
    const found = lobbyManager.findPlayerGame(4201);
    expect(found?.gid).toBe(game.gid);
  });

  it('rejects entry if game is full', async () => {
    const game = await lobbyManager.createGame({
      name: 'Duel Server',
      port: 16567,
      maxPlayers: 1,
    });

    await lobbyManager.enterGame(game.gid, clientConn, { pid: 101 });

    // Second player should fail
    await expect(
      lobbyManager.enterGame(game.gid, clientConn, { pid: 102 })
    ).rejects.toThrow(/full/i);
  });

  it('updates player attributes (UPLA) and scoreboard', async () => {
    const game = await lobbyManager.createGame({
      name: 'Scoreboard Test',
      port: 16567,
    });

    await lobbyManager.enterGame(game.gid, clientConn, { pid: 500 });

    const updated = lobbyManager.updatePlayerAttributes(game.gid, 500, {
      score: 1500,
      kills: 25,
      deaths: 3,
      ping: 45,
      team: 2,
    });

    expect(updated).toBe(true);

    const player = game.players.get(500);
    expect(player?.score).toBe(1500);
    expect(player?.kills).toBe(25);
    expect(player?.deaths).toBe(3);
    expect(player?.ping).toBe(45);
    expect(player?.team).toBe(2);
  });

  it('removes player and cleans up upon leave (ECNL / KICK)', async () => {
    const game = await lobbyManager.createGame({
      name: 'Leave Test',
      port: 16567,
      hostConnection: hostConn,
    });

    await lobbyManager.enterGame(game.gid, clientConn, { pid: 600 });
    expect(game.currentPlayers).toBe(1);

    const removed = lobbyManager.removePlayer(game.gid, 600, 'Quit');
    expect(removed).toBe(true);
    expect(game.currentPlayers).toBe(0);
    expect(lobbyManager.findPlayerGame(600)).toBeUndefined();
  });

  it('cleans up game when dedicated server host disconnects', async () => {
    const game = await lobbyManager.createGame({
      name: 'Host Drop Test',
      port: 16567,
      hostConnection: hostConn,
    });

    expect(lobbyManager.getGame(game.gid)).toBeDefined();

    lobbyManager.handleDisconnect(hostConn);

    expect(lobbyManager.getGame(game.gid)).toBeUndefined();
  });
});
