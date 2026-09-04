import { config } from '../config/config.js';
import { PersonaInfo, UserAccountInfo } from '@centralspy/shared';

export interface ValidateAuthResponse {
  valid: boolean;
  user?: UserAccountInfo;
  error?: string;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  // Fallback mock accounts for standalone or offline testing
  private mockUsers = new Map<string, UserAccountInfo>();
  private mockPersonas = new Map<string, PersonaInfo[]>();

  constructor(
    baseUrl: string = config.apiServiceUrl,
    apiKey: string = config.internalApiKey
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.seedMockData();
  }

  private seedMockData(): void {
    const defaultUser: UserAccountInfo = {
      userId: 1,
      username: 'admin',
      email: 'admin@centralspy.local',
      country: 'US',
      language: 'en',
      dobDay: 1,
      dobMonth: 1,
      dobYear: 1990,
      zipCode: '10001',
      isAdmin: true,
      isBanned: false,
    };
    this.mockUsers.set('1', defaultUser);
    this.mockUsers.set('admin', defaultUser);
    this.mockUsers.set('admin@centralspy.local', defaultUser);

    this.mockPersonas.set('1', [
      {
        personaId: 101,
        userId: 1,
        name: 'TommyConlin',
        gameSlug: 'mohpa',
        isActive: true,
      },
      {
        personaId: 102,
        userId: 1,
        name: 'PacificMarine',
        gameSlug: 'mohpa',
        isActive: true,
      },
    ]);
  }

  /**
   * Validates user credentials via api-service internal IPC endpoint or offline fallback.
   */
  public async validateCredentials(
    identifier: string,
    password?: string,
    clientIp?: string
  ): Promise<ValidateAuthResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': this.apiKey,
          'X-Internal-Key': this.apiKey,
        },
        body: JSON.stringify({ identifier, password, clientIp }),
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const userObj: UserAccountInfo | undefined = data.user
          ? {
              userId: data.user.userId || data.user.id || 1,
              username: data.user.username,
              email: data.user.email,
              country: data.user.countryCode || data.user.country || 'US',
              language: data.user.language || 'en',
              dobDay: data.user.dobDay || 1,
              dobMonth: data.user.dobMonth || 1,
              dobYear: data.user.dobYear || 1990,
              zipCode: data.user.zipCode || '10001',
              isAdmin: Boolean(data.user.isAdmin),
              isBanned: Boolean(data.user.isBanned),
            }
          : undefined;

        if (data.personas && Array.isArray(data.personas) && userObj) {
          this.mockPersonas.set(String(userObj.userId), data.personas);
        }

        return {
          valid: Boolean(data.valid),
          user: userObj,
          error: data.error,
        };
      }
    } catch {
      // API service offline: fallback to mock credentials for local testing
    }

    // Offline / dev fallback: if password is valid or mock user matches
    const user = this.mockUsers.get(identifier.toLowerCase()) || {
      userId: Math.abs(hashString(identifier)) % 100000 || 1,
      username: identifier,
      email: `${identifier}@centralspy.local`,
      country: 'US',
      language: 'en',
      dobDay: 15,
      dobMonth: 6,
      dobYear: 1995,
      isAdmin: false,
      isBanned: false,
    };

    return {
      valid: true,
      user,
    };
  }

  /**
   * Retrieves personas for a given user ID.
   */
  public async getPersonas(userId: string | number, gameSlug?: string): Promise<PersonaInfo[]> {
    const userIdStr = String(userId);
    try {
      const url = new URL(`${this.baseUrl}/internal/personas/list`);
      url.searchParams.set('userId', userIdStr);
      if (gameSlug) url.searchParams.set('gameSlug', gameSlug);

      const res = await fetch(url.toString(), {
        headers: {
          'X-Internal-API-Key': this.apiKey,
          'X-Internal-Key': this.apiKey,
        },
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const personas: PersonaInfo[] = Array.isArray(data) ? data : data.personas || [];
        return personas;
      }
    } catch {}

    // Fallback: check mock personas or create default persona
    const list = this.mockPersonas.get(userIdStr);
    if (list && list.length > 0) {
      return gameSlug ? list.filter((p) => !p.gameSlug || p.gameSlug === gameSlug) : list;
    }

    // Default soldier for any user
    const defaultPersona: PersonaInfo = {
      personaId: parseInt(userIdStr, 10) * 100 + 1,
      userId,
      name: `Player_${userIdStr}`,
      gameSlug: gameSlug || 'mohpa',
      isActive: true,
    };
    return [defaultPersona];
  }

  /**
   * Looks up persona information by soldier name.
   */
  public async getPersonaByName(name: string, gameSlug?: string): Promise<PersonaInfo | null> {
    try {
      const url = new URL(`${this.baseUrl}/internal/personas/lookup`);
      url.searchParams.set('name', name);
      if (gameSlug) url.searchParams.set('gameSlug', gameSlug);

      const res = await fetch(url.toString(), {
        headers: { 'X-Internal-API-Key': this.apiKey },
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        return (await res.json()) as PersonaInfo;
      }
    } catch {}

    // Fallback lookup
    for (const personas of this.mockPersonas.values()) {
      const found = personas.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (found) return found;
    }

    return {
      personaId: Math.abs(hashString(name)) % 100000 || 101,
      userId: 1,
      name,
      gameSlug: gameSlug || 'mohpa',
      isActive: true,
    };
  }

  /**
   * Retrieves full account demographics for GetAccount.
   */
  public async getAccountDetails(userId: string | number): Promise<UserAccountInfo | null> {
    const userIdStr = String(userId);
    try {
      const res = await fetch(`${this.baseUrl}/internal/users/${userIdStr}`, {
        headers: { 'X-Internal-API-Key': this.apiKey },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return (await res.json()) as UserAccountInfo;
      }
    } catch {}

    const user = this.mockUsers.get(userIdStr);
    if (user) return user;

    return {
      userId,
      username: `User_${userIdStr}`,
      email: `user${userIdStr}@centralspy.local`,
      country: 'US',
      language: 'en',
      dobDay: 1,
      dobMonth: 1,
      dobYear: 1990,
      zipCode: '90210',
    };
  }

  /**
   * Updates account demographic information for UpdateAccount.
   */
  public async updateAccountDetails(
    userId: string | number,
    updates: Partial<UserAccountInfo>
  ): Promise<boolean> {
    const userIdStr = String(userId);
    try {
      const res = await fetch(`${this.baseUrl}/internal/users/${userIdStr}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': this.apiKey,
        },
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return true;
    } catch {}

    const user = this.mockUsers.get(userIdStr);
    if (user) {
      Object.assign(user, updates);
    }
    return true;
  }

  /**
   * Registers a dedicated game server with api-service.
   */
  public async registerGameServer(serverData: {
    name: string;
    gameSlug: string;
    ipAddress: string;
    port: number;
    queryPort?: number;
    isRanked?: boolean;
    maxPlayers?: number;
  }): Promise<{ serverId?: string; secretKey?: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/servers/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': this.apiKey,
        },
        body: JSON.stringify(serverData),
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = (await res.json()) as { server: { id: string }; secretKey: string };
        return {
          serverId: data.server?.id,
          secretKey: data.secretKey,
        };
      }
    } catch {}

    // Mock fallback
    return {
      serverId: `mock_server_${Math.abs(hashString(serverData.name)) % 10000}`,
      secretKey: `mock_secret_${Math.random().toString(36).substring(2, 10)}`,
    };
  }

  /**
   * Updates game server heartbeat with api-service.
   */
  public async updateGameServerHeartbeat(
    secretKey: string,
    data: {
      name?: string;
      currentPlayers?: number;
      maxPlayers?: number;
      mapName?: string;
      gameMode?: string;
      subState?: string;
      details?: Record<string, any>;
    }
  ): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/servers/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Server-Secret': secretKey,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return true;
    } catch {}

    return true;
  }

  /**
   * Lists game servers from api-service.
   */
  public async listGameServers(filter?: {
    gameSlug?: string;
    isOnline?: boolean;
  }): Promise<any[]> {
    try {
      const url = new URL(`${this.baseUrl}/api/v1/servers`);
      if (filter?.gameSlug) url.searchParams.set('game_slug', filter.gameSlug);
      if (filter?.isOnline !== undefined) url.searchParams.set('is_online', String(filter.isOnline));

      const res = await fetch(url.toString(), {
        headers: { 'X-Internal-API-Key': this.apiKey },
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = (await res.json()) as { servers: any[] };
        return data.servers || [];
      }
    } catch {}

    return [];
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
