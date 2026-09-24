import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryDbClient,
  UserRepository,
  PersonaRepository,
  EntitlementRepository,
  GameServerRepository,
  StatsRepository
} from '../src/index.js';

describe('Database Repositories (In-Memory Engine)', () => {
  let db: MemoryDbClient;
  let userRepo: UserRepository;
  let personaRepo: PersonaRepository;
  let entitlementRepo: EntitlementRepository;
  let serverRepo: GameServerRepository;
  let statsRepo: StatsRepository;

  beforeEach(() => {
    db = new MemoryDbClient();
    userRepo = new UserRepository(db);
    personaRepo = new PersonaRepository(db);
    entitlementRepo = new EntitlementRepository(db);
    serverRepo = new GameServerRepository(db);
    statsRepo = new StatsRepository(db);
  });

  describe('UserRepository', () => {
    it('should create, find, and update a user', async () => {
      const user = await userRepo.create({
        username: 'TestSoldier',
        email: 'soldier@example.com',
        passwordHash: 'hash123',
        countryCode: 'US',
        dob: '1995-05-15'
      });

      expect(user.id).toBeDefined();
      expect(user.username).toBe('TestSoldier');
      expect(user.email).toBe('soldier@example.com');
      expect(user.isBanned).toBe(false);

      const byUsername = await userRepo.findByUsername('testsoldier');
      expect(byUsername?.id).toBe(user.id);

      const byEmail = await userRepo.findByEmail('soldier@example.com');
      expect(byEmail?.id).toBe(user.id);

      const updated = await userRepo.update(user.id, { countryCode: 'CA' });
      expect(updated?.countryCode).toBe('CA');

      await userRepo.setBanned(user.id, true);
      const banned = await userRepo.findById(user.id);
      expect(banned?.isBanned).toBe(true);
    });
  });

  describe('PersonaRepository', () => {
    it('should create, count, list, and delete personas', async () => {
      const user = await userRepo.create({
        username: 'PlayerOne',
        email: 'p1@example.com',
        passwordHash: 'hash123'
      });

      const persona1 = await personaRepo.create({
        userId: user.id,
        gameSlug: 'mohpa',
        name: 'MajorAssault'
      });
      expect(persona1.id).toBeDefined();
      expect(persona1.name).toBe('MajorAssault');

      const count = await personaRepo.countByUserIdAndGame(user.id, 'mohpa');
      expect(count).toBe(1);

      const byName = await personaRepo.findByNameAndGame('majorassault', 'mohpa');
      expect(byName?.id).toBe(persona1.id);

      const list = await personaRepo.findByUserId(user.id);
      expect(list).toHaveLength(1);

      await personaRepo.delete(persona1.id);
      const remaining = await personaRepo.findByUserId(user.id);
      expect(remaining).toHaveLength(0);
    });
  });

  describe('EntitlementRepository', () => {
    it('should claim and check game entitlements', async () => {
      const user = await userRepo.create({
        username: 'LicenseHolder',
        email: 'lh@example.com',
        passwordHash: 'hash123'
      });

      const ent = await entitlementRepo.claimKey(user.id, 'BF21-TEST-KEY1-XXXX', 'mohpa');
      expect(ent).not.toBeNull();
      expect(ent?.isUsed).toBe(true);

      const hasGame = await entitlementRepo.hasEntitlement(user.id, 'mohpa');
      expect(hasGame).toBe(true);

      const userEntitlements = await entitlementRepo.findByUserId(user.id);
      expect(userEntitlements).toHaveLength(1);
    });
  });

  describe('GameServerRepository', () => {
    it('should register, heartbeat, and query servers', async () => {
      const server = await serverRepo.register({
        name: 'Titan 24/7 Strike at Karkand',
        gameSlug: 'mohpa',
        ipAddress: '192.168.1.100',
        port: 17567,
        maxPlayers: 64
      });

      expect(server.id).toBeDefined();
      expect(server.secretKey).toBeDefined();
      expect(server.isOnline).toBe(true);

      await serverRepo.updateHeartbeat(server.id, { currentPlayers: 32, mapName: 'Camp Gibraltar' });

      const bySecret = await serverRepo.findBySecretKey(server.secretKey);
      expect(bySecret?.currentPlayers).toBe(32);
      expect(bySecret?.mapName).toBe('Camp Gibraltar');

      const list = await serverRepo.listServers({ gameSlug: 'mohpa' });
      expect(list).toHaveLength(1);
    });
  });

  describe('StatsRepository', () => {
    it('should record, increment stats, and generate leaderboards', async () => {
      const user = await userRepo.create({
        username: 'StatsMaster',
        email: 'stats@example.com',
        passwordHash: 'hash123'
      });

      const persona = await personaRepo.create({
        userId: user.id,
        gameSlug: 'mohpa',
        name: 'ApexReaper'
      });

      const updated = await statsRepo.incrementStats(persona.id, {
        score: 5000,
        kills: 25,
        deaths: 5,
        wins: 1
      });

      expect(updated.score).toBe(5000);
      expect(updated.kills).toBe(25);

      const leaderboard = await statsRepo.getLeaderboard('mohpa', 'score');
      expect(leaderboard.length).toBeGreaterThan(0);
      expect(leaderboard[0].personaName).toBe('ApexReaper');
      expect(leaderboard[0].name).toBe('ApexReaper');

      // Create a registered user who has not deployed a persona or played yet
      const recruit = await userRepo.create({
        username: 'RecruitCadet',
        email: 'recruit@example.com',
        passwordHash: 'hash123'
      });

      const fullLeaderboard = await statsRepo.getLeaderboard('mohpa', 'score');
      expect(fullLeaderboard.length).toBe(2);
      expect(fullLeaderboard[0].name).toBe('ApexReaper');
      expect(fullLeaderboard[1].name).toBe('RecruitCadet');
      expect(fullLeaderboard[1].score).toBe(0);

      const match = await statsRepo.recordMatch({
        gameSlug: 'mohpa',
        mapName: 'Suez Canal',
        gameMode: 'Titan',
        durationSeconds: 1200,
        winnerTeam: 1
      });
      expect(match?.id).toBeDefined();
      expect(match?.mapName).toBe('Suez Canal');
    });

    it('merges custom stats and records one row per stats match key', async () => {
      const user = await userRepo.create({
        username: 'CareerSoldier',
        email: 'career@example.com',
        passwordHash: 'hash123'
      });
      const persona = await personaRepo.create({
        userId: user.id,
        gameSlug: 'mohpa',
        name: 'Col_Voss'
      });

      const first = await statsRepo.applyMatchReport({
        statsMatchKey: 'mohpa:7:9',
        match: {
          gameSlug: 'mohpa',
          mapName: 'Guadalcanal',
          gameMode: 'Invader',
          durationSeconds: 60,
          details: { players: [{ name: 'Col_Voss' }] }
        },
        players: [{
          personaId: persona.id,
          kills: 3,
          timePlayedSeconds: 60,
          customStats: { totalNumKills: 3, totalPlayTime_Invader: 60 }
        }]
      });
      const duplicate = await statsRepo.applyMatchReport({
        statsMatchKey: 'mohpa:7:9',
        match: {
          gameSlug: 'mohpa',
          mapName: 'Guadalcanal',
          gameMode: 'Invader',
          durationSeconds: 60
        },
        players: [{
          personaId: persona.id,
          kills: 3,
          timePlayedSeconds: 60,
          customStats: { totalNumKills: 3, totalPlayTime_Invader: 60 }
        }]
      });
      const second = await statsRepo.applyMatchReport({
        statsMatchKey: 'mohpa:8:10',
        match: {
          gameSlug: 'mohpa',
          mapName: 'Guadalcanal',
          gameMode: 'Invader',
          durationSeconds: 60
        },
        players: [{
          personaId: persona.id,
          kills: 2,
          timePlayedSeconds: 30,
          customStats: { totalNumKills: 2, totalPlayTime_Invader: 30 }
        }]
      });

      expect(first.inserted).toBe(true);
      expect(duplicate.inserted).toBe(false);
      expect(second.inserted).toBe(true);
      const stats = await statsRepo.getStats(persona.id);
      expect(stats?.kills).toBe(5);
      expect(stats?.timePlayedSeconds).toBe(90);
      expect(stats?.customStats.totalNumKills).toBe(5);
      expect(stats?.customStats.totalPlayTime_Invader).toBe(90);

      await personaRepo.setGsProfileId(persona.id, 4242);
      const found = await personaRepo.findByGsProfileId(4242);
      expect(found?.id).toBe(persona.id);
    });
  });
});
