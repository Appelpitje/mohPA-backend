/**
 * CentralSpy Entitlement & CD Key Repository
 */

import { Entitlement } from '@centralspy/shared';
import { DbClient } from '../client.js';

export interface CreateEntitlementData {
  userId?: string | null;
  gameSlug: string;
  cdKey: string;
  isUsed?: boolean;
}

export class EntitlementRepository {
  constructor(private db: DbClient) {}

  public async create(data: CreateEntitlementData): Promise<Entitlement> {
    const isUsed = data.isUsed || !!data.userId;
    const activatedAt = isUsed ? new Date() : null;
    const sql = `
      INSERT INTO entitlements (user_id, game_slug, cd_key, is_used, activated_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await this.db.query(sql, [
      data.userId || null,
      data.gameSlug.toLowerCase(),
      data.cdKey.trim().toUpperCase(),
      isUsed,
      activatedAt
    ]);
    return this.mapEntitlement(result.rows[0]);
  }

  public async findByKey(cdKey: string): Promise<Entitlement | null> {
    const sql = 'SELECT * FROM entitlements WHERE UPPER(cd_key) = UPPER($1) LIMIT 1';
    const result = await this.db.query(sql, [cdKey.trim()]);
    if (result.rows.length === 0) return null;
    return this.mapEntitlement(result.rows[0]);
  }

  public async claimKey(userId: string, cdKey: string, gameSlug?: string): Promise<Entitlement | null> {
    const cleanKey = cdKey.trim().toUpperCase();

    // Check if key already exists
    const existing = await this.findByKey(cleanKey);

    if (existing) {
      if (existing.isUsed) {
        throw new Error('This CD key has already been claimed');
      }
      if (gameSlug && existing.gameSlug.toLowerCase() !== gameSlug.toLowerCase()) {
        throw new Error(`CD key is for ${existing.gameSlug}, not ${gameSlug}`);
      }

      const sql = `
        UPDATE entitlements
        SET user_id = $1, is_used = TRUE, activated_at = NOW()
        WHERE id = $2 AND is_used = FALSE
        RETURNING *
      `;
      const result = await this.db.query(sql, [userId, existing.id]);
      if (result.rows.length === 0) return null;
      return this.mapEntitlement(result.rows[0]);
    }

    // Auto-generate claimed entitlement if key pattern matches and gameSlug is provided
    if (gameSlug) {
      return this.create({
        userId,
        gameSlug,
        cdKey: cleanKey,
        isUsed: true
      });
    }

    return null;
  }

  public async findByUserId(userId: string): Promise<Entitlement[]> {
    const sql = 'SELECT * FROM entitlements WHERE user_id = $1 AND is_used = TRUE ORDER BY activated_at DESC';
    const result = await this.db.query(sql, [userId]);
    return result.rows.map(r => this.mapEntitlement(r));
  }

  public async hasEntitlement(userId: string, gameSlug: string): Promise<boolean> {
    const sql = 'SELECT id FROM entitlements WHERE user_id = $1 AND game_slug = $2 AND is_used = TRUE LIMIT 1';
    const result = await this.db.query(sql, [userId, gameSlug.toLowerCase()]);
    return result.rows.length > 0;
  }

  public async grantUserGame(userId: string, gameSlug: string): Promise<Entitlement> {
    const existing = await this.hasEntitlement(userId, gameSlug);
    if (existing) {
      const all = await this.findByUserId(userId);
      return all.find(e => e.gameSlug.toLowerCase() === gameSlug.toLowerCase())!;
    }

    const pseudoKey = `${gameSlug.toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    return this.create({
      userId,
      gameSlug,
      cdKey: pseudoKey,
      isUsed: true
    });
  }

  public async seedKeys(gameSlug: string, keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const cleanKey = key.trim().toUpperCase();
      try {
        await this.db.query(
          `INSERT INTO entitlements (game_slug, cd_key, is_used)
           VALUES ($1, $2, FALSE)
           ON CONFLICT (cd_key) DO NOTHING`,
          [gameSlug.toLowerCase(), cleanKey]
        );
        count++;
      } catch {
        // ignore duplicate seed
      }
    }
    return count;
  }

  private mapEntitlement(row: any): Entitlement {
    return {
      id: row.id,
      userId: row.user_id,
      gameSlug: row.game_slug,
      cdKey: row.cd_key,
      isUsed: Boolean(row.is_used),
      activatedAt: row.activated_at ? new Date(row.activated_at) : null
    };
  }
}
