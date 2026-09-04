import { FeslSessionData, ClientType } from '@centralspy/shared';

export type { FeslSessionData, ClientType };

export interface SessionStore {
  createSession(data: Omit<FeslSessionData, 'lkey' | 'createdAt' | 'expiresAt'> & { lkey?: string; ttlSecs?: number }): Promise<FeslSessionData>;
  getSession(lkey: string): Promise<FeslSessionData | null>;
  updateSession(lkey: string, updates: Partial<FeslSessionData>): Promise<FeslSessionData | null>;
  deleteSession(lkey: string): Promise<boolean>;
  touchSession(lkey: string, ttlSecs?: number): Promise<boolean>;
  listSessions(): Promise<FeslSessionData[]>;
  close(): Promise<void>;
  isHealthy(): boolean;
}
