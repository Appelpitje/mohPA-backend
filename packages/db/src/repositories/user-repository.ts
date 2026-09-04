/**
 * CentralSpy User Repository
 */

import { User } from '@centralspy/shared';
import { DbClient } from '../client.js';

export interface CreateUserData {
  username: string;
  email: string;
  passwordHash: string;
  countryCode?: string;
  dob?: string;
  isAdmin?: boolean;
}

export class UserRepository {
  constructor(private db: DbClient) {}

  public async create(data: CreateUserData): Promise<User> {
    const sql = `
      INSERT INTO users (username, email, password_hash, country_code, dob, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const params = [
      data.username,
      data.email,
      data.passwordHash,
      data.countryCode || 'US',
      data.dob || '2000-01-01',
      data.isAdmin || false
    ];

    const result = await this.db.query(sql, params);
    return this.mapUser(result.rows[0]);
  }

  public async findById(id: string): Promise<User | null> {
    const sql = 'SELECT * FROM users WHERE id = $1 LIMIT 1';
    const result = await this.db.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  public async findByUsername(username: string): Promise<User | null> {
    const sql = 'SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1';
    const result = await this.db.query(sql, [username]);
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  public async findByEmail(email: string): Promise<User | null> {
    const sql = 'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1';
    const result = await this.db.query(sql, [email]);
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  public async findByUsernameOrEmail(identifier: string): Promise<User | null> {
    const sql = 'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1';
    const result = await this.db.query(sql, [identifier]);
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  public async update(
    id: string,
    updates: Partial<Pick<User, 'email' | 'countryCode' | 'dob' | 'passwordHash' | 'isAdmin' | 'isBanned'>>
  ): Promise<User | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.email !== undefined) {
      setClauses.push(`email = $${paramIndex++}`);
      params.push(updates.email);
    }
    if (updates.countryCode !== undefined) {
      setClauses.push(`country_code = $${paramIndex++}`);
      params.push(updates.countryCode);
    }
    if (updates.dob !== undefined) {
      setClauses.push(`dob = $${paramIndex++}`);
      params.push(updates.dob);
    }
    if (updates.passwordHash !== undefined) {
      setClauses.push(`password_hash = $${paramIndex++}`);
      params.push(updates.passwordHash);
    }
    if (updates.isAdmin !== undefined) {
      setClauses.push(`is_admin = $${paramIndex++}`);
      params.push(updates.isAdmin);
    }
    if (updates.isBanned !== undefined) {
      setClauses.push(`is_banned = $${paramIndex++}`);
      params.push(updates.isBanned);
    }

    params.push(id);
    const sql = `
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.db.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  public async setBanned(id: string, isBanned: boolean): Promise<boolean> {
    const sql = 'UPDATE users SET is_banned = $1, updated_at = NOW() WHERE id = $2 RETURNING id';
    const result = await this.db.query(sql, [isBanned, id]);
    return result.rowCount > 0;
  }

  public async listUsers(offset = 0, limit = 50): Promise<User[]> {
    const sql = 'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const result = await this.db.query(sql, [limit, offset]);
    return result.rows.map(r => this.mapUser(r));
  }

  private mapUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      countryCode: row.country_code,
      dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : String(row.dob),
      isAdmin: Boolean(row.is_admin),
      isBanned: Boolean(row.is_banned),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
