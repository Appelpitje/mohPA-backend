/**
 * CentralSpy Game Profiles & Configuration
 */

import { GameConfig } from '../types/index.js';

export const GAME_PROFILES: Record<string, GameConfig> = {
  mohpa: {
    slug: 'mohpa',
    name: 'Medal of Honor: Pacific Assault',
    domainPartition: 'mohpa',
    subPartition: 'mohpa-server',
    defaultTheaterPort: 18275,
    defaultFeslPort: 18020,
    skus: ['MOHPA-PC', 'MOHPA-SERVER', 'MOHPA-DEMO-PC'],
    maxPersonasPerUser: 4,
    secretSalt: 'mohpa-fesl-secret',
    pingSites: [
      { name: 'iad', addr: '127.0.0.1', port: 18275, type: 1 },
      { name: 'fra', addr: '127.0.0.1', port: 18275, type: 1 }
    ],
    supportedFeatures: {
      hasGameSpyPreAuth: true,
      hasTelemetry: true,
      hasNuLogin: false,
      hasSubAccounts: true,
      usesDoubleQuotes: true
    }
  }
};

/**
 * Resolves game configuration by slug or SKU identifier.
 */
export function getGameConfig(slugOrSku: string): GameConfig | undefined {
  if (!slugOrSku) return GAME_PROFILES['mohpa'];
  const normalized = slugOrSku.toLowerCase().trim();

  // Try direct slug match
  if (GAME_PROFILES[normalized]) {
    return GAME_PROFILES[normalized];
  }

  // Try SKU matching
  for (const config of Object.values(GAME_PROFILES)) {
    if (config.skus.some(s => s.toLowerCase() === normalized)) {
      return config;
    }
  }

  // Default fallback for CentralSpy dedicated to MOHPA
  return GAME_PROFILES['mohpa'];
}

/**
 * Returns all configured game configurations.
 */
export function listGameConfigs(): GameConfig[] {
  return Object.values(GAME_PROFILES);
}

/**
 * Resolves domain partition string for a game.
 */
export function getPartitionForGame(slug: string, isDedicated: boolean = false): string {
  const config = getGameConfig(slug);
  if (!config) return 'mohpa';
  return isDedicated && config.subPartition ? config.subPartition : config.domainPartition;
}
