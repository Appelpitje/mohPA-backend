import * as crypto from 'node:crypto';
import Redis from 'ioredis';
import { FeslSessionData } from '@centralspy/shared';
import { SessionStore } from './types.js';
import { config } from '../config/config.js';

interface InMemorySessionEntry {
  data: FeslSessionData;
  expiresAtMs: number;
}

export class RedisSessionStore implements SessionStore {
  private redis: Redis | null = null;
  private isRedisOnline = false;
  private inMemoryStore = new Map<string, InMemorySessionEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private redisUrl: string = config.redisUrl || 'redis://127.0.0.1:6379') {
    this.initRedis();
    // Periodic in-memory expired session cleanup every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanupExpiredMemorySessions(), 60000);
    this.cleanupInterval.unref();
  }

  private initRedis(): void {
    if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) {
      this.isRedisOnline = false;
      return;
    }

    try {
      this.redis = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 1000, 3000);
        },
        lazyConnect: true,
        enableOfflineQueue: false,
      });

      this.redis.connect().then(() => {
        this.isRedisOnline = true;
      }).catch(() => {
        this.isRedisOnline = false;
      });

      this.redis.on('connect', () => {
        this.isRedisOnline = true;
      });

      this.redis.on('ready', () => {
        this.isRedisOnline = true;
      });

      this.redis.on('error', (err) => {
        if (this.isRedisOnline) {
          console.warn(`[RedisSessionStore] Redis error: ${err.message}. Falling back to in-memory session store.`);
        }
        this.isRedisOnline = false;
      });

      this.redis.on('close', () => {
        this.isRedisOnline = false;
      });
    } catch (err) {
      this.isRedisOnline = false;
    }
  }

  public isHealthy(): boolean {
    return this.isRedisOnline || true; // always healthy due to in-memory fallback
  }

  public isUsingRedis(): boolean {
    return this.isRedisOnline;
  }

  public generateLkey(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public async createSession(
    data: Omit<FeslSessionData, 'lkey' | 'createdAt' | 'expiresAt'> & { lkey?: string; ttlSecs?: number }
  ): Promise<FeslSessionData> {
    const lkey = data.lkey || this.generateLkey();
    const ttlSecs = data.ttlSecs ?? config.sessionTtlSecs;
    const now = Date.now();
    const expiresAt = now + ttlSecs * 1000;

    const session: FeslSessionData = {
      lkey,
      userId: data.userId,
      personaId: data.personaId,
      username: data.username,
      personaName: data.personaName,
      clientType: data.clientType,
      ip: data.ip,
      gameSlug: data.gameSlug,
      subHost: data.subHost,
      sku: data.sku,
      locale: data.locale,
      createdAt: now,
      expiresAt,
      metadata: data.metadata || {},
    };

    const redisKey = `lkey:${lkey}`;

    if (this.isRedisOnline && this.redis) {
      try {
        await this.redis.setex(redisKey, ttlSecs, JSON.stringify(session));
      } catch (err) {
        console.warn(`[RedisSessionStore] Failed to write session to Redis: ${(err as Error).message}. Storing in memory.`);
        this.storeInMemory(lkey, session, expiresAt);
      }
    } else {
      this.storeInMemory(lkey, session, expiresAt);
    }

    return session;
  }

  public async getSession(lkey: string): Promise<FeslSessionData | null> {
    if (!lkey) return null;

    if (this.isRedisOnline && this.redis) {
      try {
        const raw = await this.redis.get(`lkey:${lkey}`);
        if (raw) {
          return JSON.parse(raw) as FeslSessionData;
        }
      } catch (err) {
        console.warn(`[RedisSessionStore] Redis get failed: ${(err as Error).message}. Checking memory.`);
      }
    }

    // Check in-memory store
    const mem = this.inMemoryStore.get(lkey);
    if (mem) {
      if (Date.now() > mem.expiresAtMs) {
        this.inMemoryStore.delete(lkey);
        return null;
      }
      return mem.data;
    }

    return null;
  }

  public async updateSession(lkey: string, updates: Partial<FeslSessionData>): Promise<FeslSessionData | null> {
    const existing = await this.getSession(lkey);
    if (!existing) return null;

    const updated: FeslSessionData = {
      ...existing,
      ...updates,
      lkey: existing.lkey, // preserve original lkey
      createdAt: existing.createdAt, // preserve creation time
    };

    const remainingTtlSecs = Math.max(1, Math.floor((updated.expiresAt - Date.now()) / 1000));
    const redisKey = `lkey:${lkey}`;

    if (this.isRedisOnline && this.redis) {
      try {
        await this.redis.setex(redisKey, remainingTtlSecs, JSON.stringify(updated));
      } catch (err) {
        console.warn(`[RedisSessionStore] Redis update failed: ${(err as Error).message}. Updating memory.`);
        this.storeInMemory(lkey, updated, updated.expiresAt);
      }
    } else {
      this.storeInMemory(lkey, updated, updated.expiresAt);
    }

    return updated;
  }

  public async deleteSession(lkey: string): Promise<boolean> {
    let deleted = false;

    if (this.isRedisOnline && this.redis) {
      try {
        const res = await this.redis.del(`lkey:${lkey}`);
        deleted = res > 0;
      } catch (err) {
        console.warn(`[RedisSessionStore] Redis delete failed: ${(err as Error).message}`);
      }
    }

    if (this.inMemoryStore.has(lkey)) {
      this.inMemoryStore.delete(lkey);
      deleted = true;
    }

    return deleted;
  }

  public async touchSession(lkey: string, ttlSecs: number = config.sessionTtlSecs): Promise<boolean> {
    const now = Date.now();
    const expiresAt = now + ttlSecs * 1000;

    if (this.isRedisOnline && this.redis) {
      try {
        const session = await this.getSession(lkey);
        if (!session) return false;
        session.expiresAt = expiresAt;
        await this.redis.setex(`lkey:${lkey}`, ttlSecs, JSON.stringify(session));
        return true;
      } catch (err) {
        console.warn(`[RedisSessionStore] Redis touch failed: ${(err as Error).message}`);
      }
    }

    const mem = this.inMemoryStore.get(lkey);
    if (mem) {
      mem.data.expiresAt = expiresAt;
      mem.expiresAtMs = expiresAt;
      return true;
    }

    return false;
  }

  public async listSessions(): Promise<FeslSessionData[]> {
    const results: FeslSessionData[] = [];

    if (this.isRedisOnline && this.redis) {
      try {
        const keys = await this.redis.keys('lkey:*');
        for (const key of keys) {
          const raw = await this.redis.get(key);
          if (raw) {
            try {
              results.push(JSON.parse(raw));
            } catch {}
          }
        }
        return results;
      } catch (err) {
        console.warn(`[RedisSessionStore] Redis listSessions failed: ${(err as Error).message}`);
      }
    }

    const now = Date.now();
    for (const [key, entry] of this.inMemoryStore.entries()) {
      if (now <= entry.expiresAtMs) {
        results.push(entry.data);
      } else {
        this.inMemoryStore.delete(key);
      }
    }

    return results;
  }

  private storeInMemory(lkey: string, data: FeslSessionData, expiresAtMs: number): void {
    this.inMemoryStore.set(lkey, {
      data,
      expiresAtMs,
    });
  }

  private cleanupExpiredMemorySessions(): void {
    const now = Date.now();
    for (const [lkey, entry] of this.inMemoryStore.entries()) {
      if (now > entry.expiresAtMs) {
        this.inMemoryStore.delete(lkey);
      }
    }
  }

  public async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.redis) {
      try {
        this.redis.disconnect(false);
      } catch {}
      this.redis = null;
      this.isRedisOnline = false;
    }
    this.inMemoryStore.clear();
  }
}
