import { describe, it, expect, afterEach } from 'vitest';
import { RedisSessionStore } from '../src/session/redis-session-store.js';

describe('RedisSessionStore (In-Memory Fallback & API)', () => {
  let store: RedisSessionStore;

  afterEach(async () => {
    if (store) {
      await store.close();
    }
  });

  it('should create and retrieve a session', async () => {
    // Connect to mock/invalid port to trigger memory fallback immediately
    store = new RedisSessionStore('redis://127.0.0.1:19999');

    const created = await store.createSession({
      userId: 42,
      username: 'TestPlayer',
      clientType: 'client',
      ip: '127.0.0.1',
      gameSlug: 'mohpa',
    });

    expect(created.lkey).toBeDefined();
    expect(created.userId).toBe(42);
    expect(created.username).toBe('TestPlayer');

    const retrieved = await store.getSession(created.lkey);
    expect(retrieved).toBeDefined();
    expect(retrieved?.userId).toBe(42);
    expect(retrieved?.username).toBe('TestPlayer');
    expect(retrieved?.gameSlug).toBe('mohpa');
  });

  it('should update an existing session', async () => {
    store = new RedisSessionStore('redis://127.0.0.1:19999');

    const created = await store.createSession({
      userId: 100,
      username: 'SoldierMaster',
      clientType: 'client',
      ip: '10.0.0.1',
    });

    const updated = await store.updateSession(created.lkey, {
      personaId: 555,
      personaName: 'AlphaSquadLeader',
    });

    expect(updated).toBeDefined();
    expect(updated?.personaId).toBe(555);
    expect(updated?.personaName).toBe('AlphaSquadLeader');
    expect(updated?.username).toBe('SoldierMaster');

    const fetched = await store.getSession(created.lkey);
    expect(fetched?.personaName).toBe('AlphaSquadLeader');
  });

  it('should delete a session', async () => {
    store = new RedisSessionStore('redis://127.0.0.1:19999');

    const created = await store.createSession({
      userId: 1,
      username: 'TempUser',
      clientType: 'client',
      ip: '127.0.0.1',
    });

    const deleted = await store.deleteSession(created.lkey);
    expect(deleted).toBe(true);

    const fetched = await store.getSession(created.lkey);
    expect(fetched).toBeNull();
  });

  it('should list active sessions', async () => {
    store = new RedisSessionStore('redis://127.0.0.1:19999');

    await store.createSession({ userId: 1, username: 'User1', clientType: 'client', ip: '127.0.0.1' });
    await store.createSession({ userId: 2, username: 'User2', clientType: 'client', ip: '127.0.0.1' });

    const sessions = await store.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });
});
