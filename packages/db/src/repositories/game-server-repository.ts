/**
 * mohPA Game Server Repository
 */

import { GameServer } from '@mohpa/shared';
import { DbClient } from '../client.js';
import crypto from 'crypto';

export interface CreateGameServerData {
  name: string;
  gameSlug: string;
  ipAddress: string;
  port: number;
  queryPort?: number;
  secretKey?: string;
  isRanked?: boolean;
  isOnline?: boolean;
  maxPlayers?: number;
  currentPlayers?: number;
  mapName?: string;
  gameMode?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  ping?: number;
  tickRate?: number;
  details?: Record<string, any>;
}

export interface ServerFilter {
  gameSlug?: string;
  isOnline?: boolean;
  isRanked?: boolean;
  mapName?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class GameServerRepository {
  constructor(private db: DbClient) {}

  public async register(data: CreateGameServerData): Promise<GameServer> {
    const mergedDetails = {
      ...(data.details || {}),
      ...(data.region ? { region: data.region } : {}),
      ...(data.country ? { country: data.country } : {}),
      ...(data.countryCode ? { countryCode: data.countryCode } : {}),
      ...(data.city ? { city: data.city } : {}),
      ...(data.ping !== undefined ? { ping: data.ping } : {}),
      ...(data.tickRate !== undefined ? { tickRate: data.tickRate } : {}),
    };

    const existing = await this.findByIpAndPort(data.ipAddress, data.port);
    if (existing) {
      await this.updateServerQuery(existing.id, {
        isOnline: data.isOnline !== undefined ? data.isOnline : true,
        name: data.name,
        mapName: data.mapName,
        gameMode: data.gameMode,
        currentPlayers: data.currentPlayers,
        maxPlayers: data.maxPlayers,
        details: {
          ...(existing.details || {}),
          ...mergedDetails,
        },
        queryPort: data.queryPort,
      });
      return (await this.findById(existing.id)) || existing;
    }

    const secretKey = data.secretKey || crypto.randomBytes(24).toString('hex');
    const isOnline = data.isOnline !== undefined ? data.isOnline : true;
    const sql = `
      INSERT INTO game_servers (
        name, game_slug, ip_address, port, query_port, secret_key,
        is_ranked, is_online, last_heartbeat, max_players, current_players,
        map_name, game_mode, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12, $13)
      RETURNING *
    `;
    const params = [
      data.name,
      data.gameSlug.toLowerCase(),
      data.ipAddress,
      data.port,
      data.queryPort || 0,
      secretKey,
      data.isRanked !== undefined ? data.isRanked : true,
      isOnline,
      data.maxPlayers || 64,
      data.currentPlayers || 0,
      data.mapName || '',
      data.gameMode || '',
      JSON.stringify(mergedDetails)
    ];

    const result = await this.db.query(sql, params);
    return this.mapServer(result.rows[0]);
  }

  public async findById(id: string): Promise<GameServer | null> {
    const sql = 'SELECT * FROM game_servers WHERE id = $1 LIMIT 1';
    const result = await this.db.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapServer(result.rows[0]);
  }

  public async findBySecretKey(secretKey: string): Promise<GameServer | null> {
    const sql = 'SELECT * FROM game_servers WHERE secret_key = $1 LIMIT 1';
    const result = await this.db.query(sql, [secretKey]);
    if (result.rows.length === 0) return null;
    return this.mapServer(result.rows[0]);
  }

  public async findByIpAndPort(ipAddress: string, port: number): Promise<GameServer | null> {
    const sql = 'SELECT * FROM game_servers WHERE ip_address = $1 AND port = $2 LIMIT 1';
    const result = await this.db.query(sql, [ipAddress, port]);
    if (result.rows.length === 0) return null;
    return this.mapServer(result.rows[0]);
  }

  public async updateHeartbeat(id: string, metadata: Partial<GameServer> = {}): Promise<boolean> {
    const setClauses: string[] = ['last_heartbeat = NOW()', 'is_online = TRUE'];
    const params: any[] = [];
    let paramIndex = 1;

    if (metadata.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(metadata.name);
    }
    if (metadata.currentPlayers !== undefined) {
      setClauses.push(`current_players = $${paramIndex++}`);
      params.push(metadata.currentPlayers);
    }
    if (metadata.maxPlayers !== undefined) {
      setClauses.push(`max_players = $${paramIndex++}`);
      params.push(metadata.maxPlayers);
    }
    if (metadata.mapName !== undefined) {
      setClauses.push(`map_name = $${paramIndex++}`);
      params.push(metadata.mapName);
    }
    if (metadata.gameMode !== undefined) {
      setClauses.push(`game_mode = $${paramIndex++}`);
      params.push(metadata.gameMode);
    }
    if (metadata.subState !== undefined) {
      setClauses.push(`sub_state = $${paramIndex++}`);
      params.push(metadata.subState);
    }
    if (metadata.details !== undefined) {
      setClauses.push(`details = $${paramIndex++}`);
      params.push(JSON.stringify(metadata.details));
    }

    params.push(id);
    const sql = `
      UPDATE game_servers
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id
    `;

    const result = await this.db.query(sql, params);
    return result.rowCount > 0;
  }

  public async updateServerQuery(id: string, queryResult: Partial<GameServer> & { isOnline?: boolean }): Promise<boolean> {
    const setClauses: string[] = ['last_heartbeat = NOW()'];
    const params: any[] = [];
    let paramIndex = 1;

    if (queryResult.isOnline !== undefined) {
      setClauses.push(`is_online = $${paramIndex++}`);
      params.push(queryResult.isOnline);
    }
    if (queryResult.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(queryResult.name);
    }
    if (queryResult.currentPlayers !== undefined) {
      setClauses.push(`current_players = $${paramIndex++}`);
      params.push(queryResult.currentPlayers);
    }
    if (queryResult.maxPlayers !== undefined) {
      setClauses.push(`max_players = $${paramIndex++}`);
      params.push(queryResult.maxPlayers);
    }
    if (queryResult.mapName !== undefined) {
      setClauses.push(`map_name = $${paramIndex++}`);
      params.push(queryResult.mapName);
    }
    if (queryResult.gameMode !== undefined) {
      setClauses.push(`game_mode = $${paramIndex++}`);
      params.push(queryResult.gameMode);
    }
    if (queryResult.details !== undefined) {
      setClauses.push(`details = $${paramIndex++}`);
      params.push(JSON.stringify(queryResult.details));
    }
    if (queryResult.queryPort !== undefined) {
      setClauses.push(`query_port = $${paramIndex++}`);
      params.push(queryResult.queryPort);
    }

    params.push(id);
    const sql = `
      UPDATE game_servers
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id
    `;

    const result = await this.db.query(sql, params);
    return result.rowCount > 0;
  }

  public async listServers(filter: ServerFilter = {}): Promise<GameServer[]> {
    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.gameSlug) {
      whereClauses.push(`game_slug = $${paramIndex++}`);
      params.push(filter.gameSlug.toLowerCase());
    }
    if (filter.isOnline !== undefined) {
      whereClauses.push(`is_online = $${paramIndex++}`);
      params.push(filter.isOnline);
    }
    if (filter.isRanked !== undefined) {
      whereClauses.push(`is_ranked = $${paramIndex++}`);
      params.push(filter.isRanked);
    }
    if (filter.mapName) {
      whereClauses.push(`LOWER(map_name) = LOWER($${paramIndex++})`);
      params.push(filter.mapName);
    }
    if (filter.search) {
      whereClauses.push(`LOWER(name) LIKE LOWER($${paramIndex++})`);
      params.push(`%${filter.search}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    params.push(limit);
    const limitParam = `$${paramIndex++}`;
    params.push(offset);
    const offsetParam = `$${paramIndex++}`;

    const sql = `
      SELECT * FROM game_servers
      ${whereSql}
      ORDER BY is_online DESC, current_players DESC, last_heartbeat DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await this.db.query(sql, params);
    return result.rows.map(r => this.mapServer(r));
  }

  public async setOnlineStatus(id: string, isOnline: boolean): Promise<boolean> {
    const sql = 'UPDATE game_servers SET is_online = $1 WHERE id = $2 RETURNING id';
    const result = await this.db.query(sql, [isOnline, id]);
    return result.rowCount > 0;
  }

  public async cleanupStaleServers(staleThresholdSeconds = 120): Promise<number> {
    const sql = `
      UPDATE game_servers
      SET is_online = FALSE
      WHERE is_online = TRUE AND last_heartbeat < (NOW() - INTERVAL '${staleThresholdSeconds} seconds')
    `;
    const result = await this.db.query(sql);
    return result.rowCount;
  }

  private parseJsonField(val: any): Record<string, any> {
    if (typeof val === 'object' && val !== null) return val;
    if (typeof val === 'string') {
      try {
        const cleaned = val.replace(/::jsonb/gi, '').trim().replace(/^'|'$/g, '');
        return JSON.parse(cleaned);
      } catch {
        return {};
      }
    }
    return {};
  }

  private mapServer(row: any): GameServer {
    const details = this.parseJsonField(row.details);
    return {
      id: row.id,
      name: row.name,
      gameSlug: row.game_slug,
      ipAddress: row.ip_address,
      port: Number(row.port),
      queryPort: Number(row.query_port || 0),
      secretKey: row.secret_key,
      isRanked: Boolean(row.is_ranked),
      isOnline: Boolean(row.is_online),
      lastHeartbeat: new Date(row.last_heartbeat),
      maxPlayers: Number(row.max_players || 64),
      currentPlayers: Number(row.current_players || 0),
      mapName: row.map_name || '',
      gameMode: row.game_mode || '',
      subState: row.sub_state || 'LOBBY',
      region: row.region || details.region,
      country: row.country || details.country,
      countryCode: row.country_code || details.countryCode,
      city: row.city || details.city,
      ping: details.ping !== undefined ? Number(details.ping) : undefined,
      tickRate: details.tickRate !== undefined ? Number(details.tickRate) : undefined,
      details,
    };
  }
}

