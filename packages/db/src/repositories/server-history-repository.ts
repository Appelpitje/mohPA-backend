/**
 * mohPA Dedicated Server History & Player Presence Repository
 */

import {
  ServerHistoryRange,
  ServerHistoryChartPoint,
  ServerHistoryPlayer,
  ServerHistorySummary,
  ServerHistoryResponse,
  GameServer,
} from '@mohpa/shared';
import { DbClient } from '../client.js';

export interface RecordSnapshotDto {
  playerCount: number;
  maxPlayers?: number;
  isOnline: boolean;
  mapName?: string;
  gameMode?: string;
  recordedAt?: Date;
}

export interface PlayerPresenceDto {
  name: string;
  score?: number;
  kills?: number;
  deaths?: number;
}

export class ServerHistoryRepository {
  constructor(private db: DbClient) {}

  /**
   * Records a point-in-time server activity snapshot with throttling for identical states.
   */
  public async recordSnapshot(serverId: string, data: RecordSnapshotDto): Promise<void> {
    const recordedAt = data.recordedAt || new Date();
    const maxPlayers = data.maxPlayers || 64;
    const mapName = data.mapName || '';
    const gameMode = data.gameMode || '';

    // Throttling check: check if last snapshot was within 2 minutes with identical state
    const checkSql = `
      SELECT id, player_count, is_online, map_name, recorded_at
      FROM server_history_snapshots
      WHERE server_id = $1
      ORDER BY recorded_at DESC
      LIMIT 1
    `;
    const checkRes = await this.db.query(checkSql, [serverId]);

    if (checkRes.rows.length > 0) {
      const last = checkRes.rows[0];
      const diffMs = recordedAt.getTime() - new Date(last.recorded_at).getTime();
      const sameState =
        last.player_count === data.playerCount &&
        Boolean(last.is_online) === Boolean(data.isOnline) &&
        (last.map_name || '') === mapName;

      // If state is identical and less than 3 minutes passed, skip inserting duplicate point
      if (sameState && diffMs < 180000) {
        return;
      }
    }

    const insertSql = `
      INSERT INTO server_history_snapshots (
        server_id, player_count, max_players, is_online, map_name, game_mode, recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await this.db.query(insertSql, [
      serverId,
      data.playerCount,
      maxPlayers,
      data.isOnline,
      mapName,
      gameMode,
      recordedAt.toISOString(),
    ]);
  }

  /**
   * Records or updates active player sessions for soldiers present on the server.
   */
  public async recordPlayerSessions(
    serverId: string,
    players: PlayerPresenceDto[],
    elapsedSeconds = 30
  ): Promise<void> {
    if (!players || players.length === 0) return;

    const now = new Date();
    const activeThreshold = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes inactivity cutoff

    for (const player of players) {
      const cleanName = (player.name || '').trim();
      if (!cleanName) continue;

      const score = Math.max(0, Number(player.score || 0));
      const kills = Math.max(0, Number(player.kills !== undefined ? player.kills : score));
      const deaths = Math.max(0, Number(player.deaths || 0));

      // Check for ongoing active session
      const findSql = `
        SELECT id, duration_seconds, score, kills, deaths
        FROM server_player_sessions
        WHERE server_id = $1 AND LOWER(player_name) = LOWER($2) AND last_seen >= $3
        ORDER BY last_seen DESC
        LIMIT 1
      `;
      const findRes = await this.db.query(findSql, [
        serverId,
        cleanName,
        activeThreshold.toISOString(),
      ]);

      if (findRes.rows.length > 0) {
        const session = findRes.rows[0];
        const updateSql = `
          UPDATE server_player_sessions
          SET
            last_seen = $1,
            duration_seconds = duration_seconds + $2,
            score = GREATEST(score, $3),
            kills = GREATEST(kills, $4),
            deaths = GREATEST(deaths, $5)
          WHERE id = $6
        `;
        await this.db.query(updateSql, [
          now.toISOString(),
          elapsedSeconds,
          score,
          kills,
          deaths,
          session.id,
        ]);
      } else {
        const insertSql = `
          INSERT INTO server_player_sessions (
            server_id, player_name, score, kills, deaths, duration_seconds, first_seen, last_seen
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await this.db.query(insertSql, [
          serverId,
          cleanName,
          score,
          kills,
          deaths,
          elapsedSeconds,
          now.toISOString(),
          now.toISOString(),
        ]);
      }

      // Also continuously increment career stats in persona_stats for registered personas
      try {
        const syncPersonaSql = `
          UPDATE persona_stats ps
          SET
            time_played_seconds = ps.time_played_seconds + $1,
            score = GREATEST(ps.score, $2),
            kills = GREATEST(ps.kills, $3),
            deaths = GREATEST(ps.deaths, $4)
          FROM personas p
          WHERE ps.persona_id = p.id AND LOWER(p.name) = LOWER($5)
        `;
        await this.db.query(syncPersonaSql, [
          elapsedSeconds,
          score,
          kills,
          deaths,
          cleanName,
        ]);
      } catch {
        // Ignore if query fails on mock db
      }
    }
  }

  /**
   * Retrieves aggregated server history, charts, and 'who played' player list for a given range.
   */
  public async getServerHistory(
    serverId: string,
    range: ServerHistoryRange = '24h'
  ): Promise<ServerHistoryResponse | null> {
    // 1. Fetch server
    const serverRes = await this.db.query('SELECT * FROM game_servers WHERE id = $1 LIMIT 1', [
      serverId,
    ]);
    if (serverRes.rows.length === 0) return null;
    const serverRow = serverRes.rows[0];
    const server = this.mapServer(serverRow);

    const now = new Date();
    let startTime: Date;
    let bucketMs: number;

    switch (range) {
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        bucketMs = 60 * 60 * 1000; // 1 hour buckets = 168 points
        break;
      case '30d':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        bucketMs = 4 * 60 * 60 * 1000; // 4 hour buckets = 180 points
        break;
      case '24h':
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        bucketMs = 15 * 60 * 1000; // 15 minute buckets = 96 points
        break;
    }

    // 2. Fetch raw snapshots in range
    const snapshotSql = `
      SELECT player_count, max_players, is_online, map_name, game_mode, recorded_at
      FROM server_history_snapshots
      WHERE server_id = $1 AND recorded_at >= $2
      ORDER BY recorded_at ASC
    `;
    const snapshotsRes = await this.db.query(snapshotSql, [serverId, startTime.toISOString()]);
    let rawSnapshots = snapshotsRes.rows;

    // If server has no snapshots at all, generate initial current point
    if (rawSnapshots.length === 0) {
      rawSnapshots = [
        {
          player_count: server.currentPlayers || 0,
          max_players: server.maxPlayers || 64,
          is_online: server.isOnline,
          map_name: server.mapName || '',
          game_mode: server.gameMode || '',
          recorded_at: now.toISOString(),
        },
      ];
    }

    // 3. Bucket snapshots into regular time intervals for GameTracker chart
    const totalBuckets = Math.ceil((now.getTime() - startTime.getTime()) / bucketMs);
    const chart: ServerHistoryChartPoint[] = [];

    const firstSnapshotTime = rawSnapshots.length > 0
      ? new Date(rawSnapshots[0].recorded_at).getTime()
      : null;

    let currentSnapshotIdx = 0;
    let lastKnownPlayerCount = 0;
    let lastKnownOnline = server.isOnline;
    let lastKnownMap = server.mapName || '';
    let lastSnapshotTimeMs = 0;
    const maxPlayers = server.maxPlayers || 64;

    for (let i = 0; i <= totalBuckets; i++) {
      const bucketTime = new Date(startTime.getTime() + i * bucketMs);
      if (bucketTime.getTime() > now.getTime()) break;

      const bucketEndTime = new Date(bucketTime.getTime() + bucketMs);
      const pointsInBucket: any[] = [];

      while (
        currentSnapshotIdx < rawSnapshots.length &&
        new Date(rawSnapshots[currentSnapshotIdx].recorded_at).getTime() < bucketEndTime.getTime()
      ) {
        pointsInBucket.push(rawSnapshots[currentSnapshotIdx]);
        currentSnapshotIdx++;
      }

      if (pointsInBucket.length > 0) {
        // Take the latest actual snapshot in this interval (ACTUAL player count on that moment!)
        const latestInBucket = pointsInBucket[pointsInBucket.length - 1];
        const actualCount = Number(latestInBucket.player_count || 0);
        let peakCount = actualCount;
        let onlineCount = 0;

        for (const p of pointsInBucket) {
          const count = Number(p.player_count || 0);
          if (count > peakCount) peakCount = count;
          if (p.is_online) onlineCount++;
        }

        const isOnline = onlineCount > 0;
        const bestMap = latestInBucket.map_name || lastKnownMap;

        lastKnownPlayerCount = actualCount;
        lastKnownOnline = isOnline;
        lastKnownMap = bestMap;
        lastSnapshotTimeMs = new Date(latestInBucket.recorded_at).getTime();

        chart.push({
          timestamp: bucketTime.toISOString(),
          playerCount: actualCount,
          peakCount: Math.max(actualCount, peakCount),
          maxPlayers: Number(latestInBucket.max_players || maxPlayers),
          isOnline,
          mapName: bestMap,
        });
      } else {
        const isBeforeFirstSnapshot = firstSnapshotTime !== null && bucketTime.getTime() < firstSnapshotTime - 10 * 60 * 1000;
        const isStaleGap = lastSnapshotTimeMs === 0 || (bucketTime.getTime() - lastSnapshotTimeMs > 20 * 60 * 1000);

        const playerCountAtMoment = (isBeforeFirstSnapshot || isStaleGap) ? 0 : lastKnownPlayerCount;

        chart.push({
          timestamp: bucketTime.toISOString(),
          playerCount: lastKnownOnline ? playerCountAtMoment : 0,
          peakCount: lastKnownOnline ? playerCountAtMoment : 0,
          maxPlayers,
          isOnline: isBeforeFirstSnapshot ? false : lastKnownOnline,
          mapName: lastKnownMap,
        });
      }
    }

    // Ensure the very latest point reflects the live server state at this exact moment
    if (chart.length > 0) {
      const latest = chart[chart.length - 1];
      latest.playerCount = server.isOnline ? (server.currentPlayers || 0) : 0;
      latest.peakCount = Math.max(latest.peakCount || 0, latest.playerCount);
      latest.isOnline = server.isOnline;
      if (server.mapName) latest.mapName = server.mapName;
    }

    // 4. Calculate Summary KPIs
    let peakPlayers = server.currentPlayers || 0;
    let peakPlayersTime = now.toISOString();
    let totalPlayersSum = 0;
    let onlinePointsCount = 0;
    let minPlayers = server.isOnline ? server.currentPlayers || 0 : 0;
    const mapAgg: Record<string, number> = {};

    for (const pt of chart) {
      if (pt.isOnline) {
        onlinePointsCount++;
        totalPlayersSum += pt.playerCount;
        if (pt.playerCount < minPlayers) {
          minPlayers = pt.playerCount;
        }
      }
      if ((pt.peakCount || pt.playerCount) > peakPlayers) {
        peakPlayers = pt.peakCount || pt.playerCount;
        peakPlayersTime = pt.timestamp;
      }
      if (pt.mapName) {
        mapAgg[pt.mapName] = (mapAgg[pt.mapName] || 0) + 1;
      }
    }

    const averagePlayers =
      onlinePointsCount > 0
        ? Math.round((totalPlayersSum / onlinePointsCount) * 10) / 10
        : server.currentPlayers || 0;
    const uptimePercentage =
      chart.length > 0 ? Math.round((onlinePointsCount / chart.length) * 1000) / 10 : 100;

    // Top maps breakdown
    const topMaps = Object.entries(mapAgg)
      .map(([mapName, occurrences]) => ({
        mapName,
        occurrences,
        percentage: chart.length > 0 ? Math.round((occurrences / chart.length) * 100) : 0,
      }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5);

    // 5. Query "Who Played" Historical Player Sessions
    const playersSql = `
      SELECT
        player_name,
        MAX(score) as score,
        MAX(kills) as kills,
        MAX(deaths) as deaths,
        SUM(duration_seconds) as total_duration,
        COUNT(*) as session_count,
        MIN(first_seen) as first_seen,
        MAX(last_seen) as last_seen
      FROM server_player_sessions
      WHERE server_id = $1 AND last_seen >= $2
      GROUP BY LOWER(player_name), player_name
      ORDER BY total_duration DESC, score DESC
      LIMIT 100
    `;
    const playersRes = await this.db.query(playersSql, [serverId, startTime.toISOString()]);

    const livePlayers = new Set<string>();
    if (server.details?.players && Array.isArray(server.details.players)) {
      server.details.players.forEach((p: any) => {
        if (p?.name) livePlayers.add(p.name.toLowerCase().trim());
      });
    }

    const players: ServerHistoryPlayer[] = playersRes.rows.map((r: any) => {
      const name = r.player_name;
      const isOnline = livePlayers.has(name.toLowerCase().trim());
      const sScore = Number(r.score || 0);
      const sKills = Number(r.kills !== undefined && r.kills !== null ? r.kills : sScore);
      const kills = Math.max(sKills, sScore);
      const deaths = Number(r.deaths || 0);

      return {
        name,
        score: sScore,
        kills,
        deaths,
        timePlayedSeconds: Number(r.total_duration || 0),
        sessionCount: Number(r.session_count || 1),
        firstSeen: new Date(r.first_seen).toISOString(),
        lastSeen: new Date(r.last_seen).toISOString(),
        isOnline,
      };
    });

    // Optionally augment with career stats for registered personas
    if (players.length > 0) {
      try {
        const names = players.map((p) => p.name.toLowerCase());
        const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
        const statsRes = await this.db.query(
          `SELECT LOWER(p.name) as name, ps.kills, ps.deaths FROM personas p JOIN persona_stats ps ON ps.persona_id = p.id WHERE LOWER(p.name) IN (${placeholders})`,
          names
        );
        const statsMap = new Map<string, { kills: number; deaths: number }>();
        for (const row of statsRes.rows) {
          statsMap.set(row.name, {
            kills: Number(row.kills || 0),
            deaths: Number(row.deaths || 0),
          });
        }
        for (const p of players) {
          const c = statsMap.get(p.name.toLowerCase());
          if (c) {
            p.kills = Math.max(p.kills, c.kills);
            p.deaths = Math.max(p.deaths, c.deaths);
          }
        }
      } catch {
        // Ignore if query fails
      }
    }

    // If server currently has active players in details.players not yet in historical table:
    if (server.details?.players && Array.isArray(server.details.players)) {
      for (const lp of server.details.players) {
        if (!lp?.name) continue;
        const lpScore = Number(lp.score || 0);
        const lpKills = Number(lp.kills !== undefined ? lp.kills : lpScore);
        const lpDeaths = Number(lp.deaths || 0);
        const existing = players.find((p) => p.name.toLowerCase() === lp.name.toLowerCase().trim());

        if (existing) {
          existing.score = Math.max(existing.score, lpScore);
          existing.kills = Math.max(existing.kills, lpKills);
          existing.deaths = Math.max(existing.deaths, lpDeaths);
          existing.isOnline = true;
        } else {
          players.unshift({
            name: lp.name,
            score: lpScore,
            kills: lpKills,
            deaths: lpDeaths,
            timePlayedSeconds: 60,
            sessionCount: 1,
            firstSeen: now.toISOString(),
            lastSeen: now.toISOString(),
            isOnline: true,
          });
        }
      }
    }

    // Ensure consistent ordering: highest play time first, then highest score
    players.sort((a, b) => (b.timePlayedSeconds - a.timePlayedSeconds) || (b.score - a.score));

    const uniquePlayersCount = players.length;
    const totalSessions = players.reduce((sum, p) => sum + p.sessionCount, 0);

    const summary: ServerHistorySummary = {
      currentPlayers: server.currentPlayers || 0,
      peakPlayers,
      peakPlayersTime,
      averagePlayers,
      minPlayers,
      uptimePercentage,
      totalSessions,
      uniquePlayersCount,
      topMaps,
    };

    return {
      server,
      range,
      summary,
      chart,
      players,
    };
  }

  /**
   * Seeds realistic sample history data for testing / development.
   */
  public async seedSampleHistory(serverId: string, days = 30): Promise<void> {
    const serverRes = await this.db.query('SELECT * FROM game_servers WHERE id = $1', [serverId]);
    if (serverRes.rows.length === 0) return;
    const srv = serverRes.rows[0];
    const maxPlayers = srv.max_players || 32;

    const maps = ['Henderson Airfield', 'Guadalcanal', 'Wake Island', 'Corregidor', 'Pearl Harbor'];
    const samplePlayers = [
      'Sgt_Miller',
      'Capt_Speirs',
      'Doc_Roe',
      'Lt_Winters',
      'Pvt_Ryan',
      'Cpl_Upham',
      'GunnerySgt_Hartman',
      'Major_Davis',
      'Col_Voss',
      'Sgt_Rock',
      'Baron_Von_Steuben',
      'Pvt_Jackson',
      'Cpl_Henderson',
      'Sgt_Horvath',
      'Pvt_Mellish',
    ];

    const now = Date.now();
    const intervalMs = 60 * 60 * 1000; // 1 snapshot per hour
    const totalPoints = days * 24;

    for (let i = totalPoints; i >= 0; i--) {
      const timestamp = new Date(now - i * intervalMs);
      const hour = timestamp.getUTCHours();

      // Diurnal curve: peak in evening (17:00 - 23:00 UTC), low at night (03:00 - 08:00 UTC)
      const hourFactor = Math.sin(((hour - 8) / 24) * 2 * Math.PI) * 0.5 + 0.5; // 0 to 1
      const count = Math.max(0, Math.min(maxPlayers, Math.round(hourFactor * (maxPlayers * 0.85) + (Math.random() * 4 - 2))));
      const map = maps[Math.floor(i / 6) % maps.length];

      await this.db.query(
        `INSERT INTO server_history_snapshots (
          server_id, player_count, max_players, is_online, map_name, game_mode, recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [serverId, count, maxPlayers, true, map, 'Invader', timestamp.toISOString()]
      );

      // Periodically seed player sessions
      if (count > 0 && i % 4 === 0) {
        const activeCount = Math.min(count, samplePlayers.length);
        for (let pIdx = 0; pIdx < activeCount; pIdx++) {
          const pName = samplePlayers[pIdx];
          const duration = Math.round(900 + Math.random() * 3600);
          const score = Math.round(500 + Math.random() * 4000);
          const kills = Math.round(5 + Math.random() * 35);
          const deaths = Math.round(2 + Math.random() * 20);

          await this.db.query(
            `INSERT INTO server_player_sessions (
              server_id, player_name, score, kills, deaths, duration_seconds, first_seen, last_seen
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              serverId,
              pName,
              score,
              kills,
              deaths,
              duration,
              new Date(timestamp.getTime() - duration * 1000).toISOString(),
              timestamp.toISOString(),
            ]
          );
        }
      }
    }
  }

  private mapServer(row: any): GameServer {
    let details: any = {};
    if (typeof row.details === 'object' && row.details !== null) {
      details = row.details;
    } else if (typeof row.details === 'string') {
      try {
        details = JSON.parse(row.details);
      } catch {
        details = {};
      }
    }

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
