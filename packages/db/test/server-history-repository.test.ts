import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryDbClient,
  GameServerRepository,
  ServerHistoryRepository,
} from '../src/index.js';

describe('ServerHistoryRepository (In-Memory Engine)', () => {
  let db: MemoryDbClient;
  let serverRepo: GameServerRepository;
  let historyRepo: ServerHistoryRepository;
  let serverId: string;

  beforeEach(async () => {
    db = new MemoryDbClient();
    serverRepo = new GameServerRepository(db);
    historyRepo = new ServerHistoryRepository(db);

    const srv = await serverRepo.register({
      name: 'CentralSpy Pacific Combat',
      gameSlug: 'mohpa',
      ipAddress: '192.168.1.100',
      port: 12203,
      isRanked: true,
      maxPlayers: 32,
      currentPlayers: 10,
      mapName: 'Henderson Airfield',
      gameMode: 'Invader',
    });
    serverId = srv.id;
  });

  describe('recordSnapshot', () => {
    it('records a snapshot and throttles identical snapshots within 2 minutes', async () => {
      const t1 = new Date();
      await historyRepo.recordSnapshot(serverId, {
        playerCount: 12,
        maxPlayers: 32,
        isOnline: true,
        mapName: 'Henderson Airfield',
        recordedAt: t1,
      });

      let rows = db.tables.get('server_history_snapshots') || [];
      expect(rows.length).toBe(1);
      expect(rows[0].player_count).toBe(12);

      // Same state 30 seconds later -> should be throttled/skipped
      const t2 = new Date(t1.getTime() + 30 * 1000);
      await historyRepo.recordSnapshot(serverId, {
        playerCount: 12,
        maxPlayers: 32,
        isOnline: true,
        mapName: 'Henderson Airfield',
        recordedAt: t2,
      });
      rows = db.tables.get('server_history_snapshots') || [];
      expect(rows.length).toBe(1);

      // State changed (player joined) -> should record immediately
      const t3 = new Date(t1.getTime() + 45 * 1000);
      await historyRepo.recordSnapshot(serverId, {
        playerCount: 13,
        maxPlayers: 32,
        isOnline: true,
        mapName: 'Henderson Airfield',
        recordedAt: t3,
      });
      rows = db.tables.get('server_history_snapshots') || [];
      expect(rows.length).toBe(2);
      expect(rows[1].player_count).toBe(13);
    });
  });

  describe('recordPlayerSessions', () => {
    it('creates and accumulates sessions for active players', async () => {
      // First poll: Sgt_Miller with 500 score
      await historyRepo.recordPlayerSessions(
        serverId,
        [{ name: 'Sgt_Miller', score: 500, kills: 5, deaths: 1 }],
        30
      );

      let sessions = db.tables.get('server_player_sessions') || [];
      expect(sessions.length).toBe(1);
      expect(sessions[0].player_name).toBe('Sgt_Miller');
      expect(sessions[0].duration_seconds).toBe(30);
      expect(sessions[0].score).toBe(500);

      // Second poll 30 seconds later: same player, higher score
      await historyRepo.recordPlayerSessions(
        serverId,
        [{ name: 'Sgt_Miller', score: 750, kills: 8, deaths: 2 }],
        30
      );

      sessions = db.tables.get('server_player_sessions') || [];
      expect(sessions.length).toBe(1); // Updated existing active session
      expect(sessions[0].duration_seconds).toBe(60);
      expect(sessions[0].score).toBe(750);
      expect(sessions[0].kills).toBe(8);

      // Another player joins: Capt_Speirs
      await historyRepo.recordPlayerSessions(
        serverId,
        [
          { name: 'Sgt_Miller', score: 900, kills: 9, deaths: 2 },
          { name: 'Capt_Speirs', score: 1200, kills: 14, deaths: 0 },
        ],
        30
      );

      sessions = db.tables.get('server_player_sessions') || [];
      expect(sessions.length).toBe(2);
    });
  });

  describe('getServerHistory', () => {
    it('returns structured chart points, summary KPIs, and who played list', async () => {
      // Seed some snapshots across the last 6 hours
      const now = Date.now();
      for (let i = 12; i >= 0; i--) {
        const time = new Date(now - i * 30 * 60 * 1000);
        await historyRepo.recordSnapshot(serverId, {
          playerCount: 8 + (i % 6),
          maxPlayers: 32,
          isOnline: true,
          mapName: i % 2 === 0 ? 'Henderson Airfield' : 'Guadalcanal',
          recordedAt: time,
        });
      }

      // Add player presence
      await historyRepo.recordPlayerSessions(
        serverId,
        [
          { name: 'Col_Voss', score: 3200, kills: 28, deaths: 10 },
          { name: 'Doc_Roe', score: 1450, kills: 8, deaths: 3 },
        ],
        1200
      );

      const res24h = await historyRepo.getServerHistory(serverId, '24h');
      expect(res24h).not.toBeNull();
      expect(res24h?.range).toBe('24h');
      expect(res24h?.chart.length).toBeGreaterThan(0);
      expect(res24h?.summary.peakPlayers).toBeGreaterThanOrEqual(10);
      expect(res24h?.summary.averagePlayers).toBeGreaterThan(0);
      expect(res24h?.summary.uptimePercentage).toBeGreaterThan(0);
      expect(res24h?.players.length).toBeGreaterThanOrEqual(2);
      expect(res24h?.players[0].name).toBe('Col_Voss');
      expect(res24h?.players[0].score).toBe(3200);

      // 7d view
      const res7d = await historyRepo.getServerHistory(serverId, '7d');
      expect(res7d?.range).toBe('7d');
      expect(res7d?.chart.length).toBeGreaterThan(0);

      // 30d view
      const res30d = await historyRepo.getServerHistory(serverId, '30d');
      expect(res30d?.range).toBe('30d');
      expect(res30d?.chart.length).toBeGreaterThan(0);
    });

    it('returns null for non-existent server', async () => {
      const res = await historyRepo.getServerHistory('00000000-0000-0000-0000-000000000000');
      expect(res).toBeNull();
    });
  });

  describe('seedSampleHistory', () => {
    it('seeds sample data when requested', async () => {
      await historyRepo.seedSampleHistory(serverId, 7);
      const res = await historyRepo.getServerHistory(serverId, '7d');
      expect(res?.chart.length).toBeGreaterThan(20);
      expect(res?.players.length).toBeGreaterThan(0);
    });
  });
});
