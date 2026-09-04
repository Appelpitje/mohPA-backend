import { describe, it, expect } from 'vitest';
import { getGameConfig, listGameConfigs, getPartitionForGame } from '../src/config/games.js';

describe('Game Configurations', () => {
  it('should retrieve Medal of Honor: Pacific Assault as sole supported game', () => {
    const games = listGameConfigs();
    expect(games.length).toBe(1);

    const slugs = games.map(g => g.slug);
    expect(slugs).toEqual(['mohpa']);
    expect(games[0].name).toBe('Medal of Honor: Pacific Assault');
    expect(games[0].defaultFeslPort).toBe(18020);
    expect(games[0].defaultTheaterPort).toBe(18275);
  });

  it('should resolve config by SKU and partition', () => {
    const mohpa = getGameConfig('MOHPA-PC');
    expect(mohpa).toBeDefined();
    expect(mohpa?.slug).toBe('mohpa');
    expect(getPartitionForGame('mohpa')).toBe('mohpa');
    expect(getPartitionForGame('mohpa', true)).toBe('mohpa-server');

    const serverConfig = getGameConfig('MOHPA-SERVER');
    expect(serverConfig?.slug).toBe('mohpa');

    const demoConfig = getGameConfig('MOHPA-DEMO-PC');
    expect(demoConfig?.slug).toBe('mohpa');

    // Fallback resolving
    const fallback = getGameConfig('unknown-sku');
    expect(fallback?.slug).toBe('mohpa');
  });
});
