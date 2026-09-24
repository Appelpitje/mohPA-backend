import { describe, it, expect, afterEach } from 'vitest';
import * as dgram from 'node:dgram';
import {
  parseGameSpy1Response,
  parseQuake3Response,
  queryGameServer,
} from '../src/query/game-query.js';

describe('Game Server Query Engine', () => {
  describe('parseGameSpy1Response', () => {
    it('correctly parses GameSpy 1 status string with players and rules', () => {
      const gs1Sample =
        '\\hostname\\mohPA Pacific Theater\\hostport\\13200\\mapname\\Henderson Airfield\\gametype\\Invader\\numplayers\\2\\maxplayers\\32\\gamever\\1.2\\dedicated\\1\\timelimit\\20\\player_0\\TommyConlin\\score_0\\100\\ping_0\\25\\team_0\\1\\player_1\\SergeantFoley\\score_1\\75\\ping_1\\45\\team_1\\2\\final\\';

      const parsed = parseGameSpy1Response(gs1Sample);
      expect(parsed.name).toBe('mohPA Pacific Theater');
      expect(parsed.mapName).toBe('Henderson Airfield');
      expect(parsed.gameMode).toBe('Invader');
      expect(parsed.currentPlayers).toBe(2);
      expect(parsed.maxPlayers).toBe(32);
      expect(parsed.protocol).toBe('gamespy1');
      expect(parsed.players).toHaveLength(2);
      expect(parsed.players[0]).toEqual({
        name: 'TommyConlin',
        score: 100,
        kills: 100,
        deaths: 0,
        ping: 25,
        team: 1,
      });
      expect(parsed.players[1]).toEqual({
        name: 'SergeantFoley',
        score: 75,
        kills: 75,
        deaths: 0,
        ping: 45,
        team: 2,
      });
      expect(parsed.rules.timelimit).toBe('20');
      expect(parsed.rules.dedicated).toBe('1');
    });
  });

  describe('parseQuake3Response', () => {
    it('correctly parses Quake 3 / id Tech 3 statusResponse packet', () => {
      const q3Sample =
        '\xFF\xFF\xFF\xFFstatusResponse\n\\sv_hostname\\MOHPA Iron Man Server\\mapname\\mohaa1\\gametype\\TDM\\sv_maxclients\\24\\version\\MOHPA 1.2\\pure\\1\n15 35 "PrivateRyan"\n10 60 "CaptainMiller"\n';

      const parsed = parseQuake3Response(q3Sample);
      expect(parsed.name).toBe('MOHPA Iron Man Server');
      expect(parsed.mapName).toBe('mohaa1');
      expect(parsed.gameMode).toBe('TDM');
      expect(parsed.currentPlayers).toBe(2);
      expect(parsed.maxPlayers).toBe(24);
      expect(parsed.protocol).toBe('quake3');
      expect(parsed.players).toHaveLength(2);
      expect(parsed.players[0]).toEqual({
        name: 'PrivateRyan',
        score: 15,
        kills: 15,
        deaths: 0,
        ping: 35,
      });
      expect(parsed.players[1]).toEqual({
        name: 'CaptainMiller',
        score: 10,
        kills: 10,
        deaths: 0,
        ping: 60,
      });
    });
  });

  describe('queryGameServer UDP integration', () => {
    let mockSocket: dgram.Socket | null = null;

    afterEach(() => {
      if (mockSocket) {
        try {
          mockSocket.close();
        } catch {}
        mockSocket = null;
      }
    });

    it('queries a live GameSpy 1 server and extracts telemetry', async () => {
      mockSocket = dgram.createSocket('udp4');
      await new Promise<void>((resolve) => mockSocket!.bind(0, '127.0.0.1', () => resolve()));
      const port = mockSocket.address().port;

      mockSocket.on('message', (msg, rinfo) => {
        const text = msg.toString('utf-8');
        if (text.includes('status')) {
          const resp =
            '\\hostname\\Live GS1 Node\\hostport\\13200\\mapname\\Guadalcanal\\gametype\\Invader\\numplayers\\1\\maxplayers\\64\\player_0\\Marine1\\score_0\\50\\ping_0\\30\\final\\';
          mockSocket!.send(resp, rinfo.port, rinfo.address);
        }
      });

      const res = await queryGameServer({
        host: '127.0.0.1',
        port: 13200,
        queryPort: port,
        timeoutMs: 1000,
      });

      expect(res.online).toBe(true);
      expect(res.name).toBe('Live GS1 Node');
      expect(res.mapName).toBe('Guadalcanal');
      expect(res.gameMode).toBe('Invader');
      expect(res.currentPlayers).toBe(1);
      expect(res.maxPlayers).toBe(64);
      expect(res.players).toHaveLength(1);
      expect(res.players[0].name).toBe('Marine1');
      expect(res.protocol).toBe('gamespy1');
      expect(res.ping).toBeGreaterThanOrEqual(0);
    });

    it('queries a live Quake 3 server and extracts telemetry', async () => {
      mockSocket = dgram.createSocket('udp4');
      await new Promise<void>((resolve) => mockSocket!.bind(0, '127.0.0.1', () => resolve()));
      const port = mockSocket.address().port;

      mockSocket.on('message', (msg, rinfo) => {
        const text = msg.toString('binary');
        if (text.includes('getstatus')) {
          const resp =
            '\xFF\xFF\xFF\xFFstatusResponse\n\\sv_hostname\\Live Q3 Node\\mapname\\Henderson\\gametype\\Obj\\sv_maxclients\\32\n20 40 "Hero"\n';
          mockSocket!.send(Buffer.from(resp, 'binary'), rinfo.port, rinfo.address);
        }
      });

      const res = await queryGameServer({
        host: '127.0.0.1',
        port: port,
        queryPort: port,
        timeoutMs: 1000,
      });

      expect(res.online).toBe(true);
      expect(res.name).toBe('Live Q3 Node');
      expect(res.mapName).toBe('Henderson');
      expect(res.gameMode).toBe('Obj');
      expect(res.currentPlayers).toBe(1);
      expect(res.maxPlayers).toBe(32);
      expect(res.players[0].name).toBe('Hero');
      expect(res.protocol).toBe('quake3');
    });

    it('returns offline status when server is unreachable or times out', async () => {
      const res = await queryGameServer({
        host: '127.0.0.1',
        port: 59999,
        queryPort: 59999,
        timeoutMs: 150,
      });

      expect(res.online).toBe(false);
      expect(res.currentPlayers).toBe(0);
      expect(res.error).toBeDefined();
    });
  });
});
