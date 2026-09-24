import { config } from '../config/config.js';
import { PersonaInfo, UserAccountInfo } from '@mohpa/shared';

export interface ValidateAuthResponse {
  valid: boolean;
  user?: UserAccountInfo;
  error?: string;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(
    baseUrl: string = config.apiServiceUrl,
    apiKey: string = config.internalApiKey
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Validates user credentials via api-service internal IPC endpoint.
   * Returns valid: false if credentials are wrong or api-service is unreachable.
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
              userId: data.user.userId || data.user.id,
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

        return {
          valid: Boolean(data.valid),
          user: userObj,
          error: data.error,
        };
      } else {
        const data = await res.json().catch(() => ({})) as any;
        return {
          valid: false,
          error: data.error || (res.status === 401 ? 'Invalid username or password' : 'Authentication failed'),
        };
      }
    } catch (err) {
      console.error(`[ApiClient] Failed to reach api-service at ${this.baseUrl}:`, (err as Error).message);
      return {
        valid: false,
        error: 'Authentication service unavailable',
      };
    }
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
    } catch (err) {
      console.error(`[ApiClient] Failed to get personas for userId ${userIdStr}:`, (err as Error).message);
    }

    return [];
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
    } catch (err) {
      console.error(`[ApiClient] Failed to lookup persona ${name}:`, (err as Error).message);
    }

    return null;
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
    } catch (err) {
      console.error(`[ApiClient] Failed to get account details for userId ${userIdStr}:`, (err as Error).message);
    }

    return null;
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
    } catch (err) {
      console.error(`[ApiClient] Failed to update account details for userId ${userIdStr}:`, (err as Error).message);
    }

    return false;
  }

  public async getPersonaByGsProfileId(gsProfileId: number, gameSlug = 'mohpa'): Promise<any | null> {
    try {
      const url = new URL(`${this.baseUrl}/internal/personas/lookup`);
      url.searchParams.set('gsProfileId', String(gsProfileId));
      if (gameSlug) url.searchParams.set('gameSlug', gameSlug);
      const res = await fetch(url.toString(), {
        headers: { 'X-Internal-API-Key': this.apiKey },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return await res.json();
    } catch (err) {
      console.error(`[ApiClient] Failed to lookup gs profile ${gsProfileId}:`, (err as Error).message);
    }
    return null;
  }

  public async rememberGsProfile(name: string, gameSlug: string, gsProfileId: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/personas/gs-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': this.apiKey,
        },
        body: JSON.stringify({ name, gameSlug, gsProfileId }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err) {
      console.error(`[ApiClient] rememberGsProfile failed:`, (err as Error).message);
      return false;
    }
  }

  public async reportMatch(body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/stats/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': this.apiKey,
          'X-Internal-Key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        console.error(`[ApiClient] reportMatch HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[ApiClient] reportMatch failed:`, (err as Error).message);
      return false;
    }
  }

  public async writePersist(personaId: string, kv: number, data: Record<string, number>): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/stats/persist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': this.apiKey,
        },
        body: JSON.stringify({ personaId, kv, data }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err) {
      console.error(`[ApiClient] writePersist failed:`, (err as Error).message);
      return false;
    }
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
    skipQuery?: boolean;
    mapName?: string;
    gameMode?: string;
    currentPlayers?: number;
    region?: string;
    country?: string;
    countryCode?: string;
    city?: string;
    ping?: number;
    tickRate?: number;
    details?: Record<string, any>;
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
    } catch (err) {
      console.error(`[ApiClient] Failed to register game server:`, (err as Error).message);
    }

    return null;
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
