import { describe, it, expect } from 'vitest';
import { buildStatsReport, GstatsMatchBuffer } from '../src/gamespy/stats-ingest.js';

describe('stats ingest', () => {
  it('maps numKills and playTime for a known soldier', async () => {
    const gamedata = '\\numKills_0\\3\\playTime_0\\60\\player_0\\Col_Voss\\gametype\\Invader\\map\\Guadalcanal';
    const report = await buildStatsReport('7', '9', gamedata, async (name) => (name === 'Col_Voss' ? 'persona-1' : null));
    expect(report.statsMatchKey).toBe('mohpa:7:9');
    expect(report.match.mapName).toBe('Guadalcanal');
    expect(report.match.gameMode).toBe('Invader');
    expect(report.match.durationSeconds).toBe(60);
    expect(report.players).toEqual([
      {
        personaId: 'persona-1',
        kills: 3,
        deaths: 0,
        score: 0,
        timePlayedSeconds: 60,
        customStats: { totalNumKills: 3, totalPlayTime_Invader: 60 },
      },
    ]);
  });

  it('keeps an unknown name on the match and does not invent a persona', async () => {
    const report = await buildStatsReport('1', '2', '\\player_0\\GhostSoldier\\numKills_0\\1', async () => null);
    expect(report.players).toEqual([]);
    expect(report.match.details.players[0].name).toBe('GhostSoldier');
    expect(report.match.details.players[0].personaId).toBeUndefined();
  });

  it('holds done=0 in memory and releases done=1', () => {
    const buffer = new GstatsMatchBuffer();
    expect(buffer.takeFinal({ connid: '1', sesskey: '2', done: '0', gamedata: 'numKills_0\\3' })).toBeNull();
    const finalSnap = buffer.takeFinal({ connid: '1', sesskey: '2', done: '1', gamedata: '' });
    expect(finalSnap?.gamedata).toBe('numKills_0\\3');
  });
});
