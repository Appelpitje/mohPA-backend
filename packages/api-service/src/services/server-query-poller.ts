/**
 * CentralSpy Dedicated Server UDP Query Poller
 * Periodically polls registered dedicated servers to keep maps, player counts,
 * scoreboards, and online status in sync with authentic game server binaries.
 */

import { GameServerRepository } from '@centralspy/db';
import { queryGameServer } from '@centralspy/shared';

export class ServerQueryPoller {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private intervalMs: number;

  constructor(
    private serverRepo: GameServerRepository,
    intervalMs = 30000
  ) {
    this.intervalMs = intervalMs;
  }

  /**
   * Starts periodic polling of registered servers.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Schedule next run
    this.timer = setInterval(() => {
      this.pollAllServers().catch((err) => {
        console.error('[ServerQueryPoller] Error during server poll pass:', err);
      });
    }, this.intervalMs);

    // Initial poll after short delay (5s)
    setTimeout(() => {
      if (this.isRunning) {
        this.pollAllServers().catch(() => {});
      }
    }, 5000);
  }

  /**
   * Stops polling.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Polls all registered servers and updates their state in database.
   */
  public async pollAllServers(): Promise<number> {
    try {
      const servers = await this.serverRepo.listServers({ limit: 500 });
      let updatedCount = 0;

      for (const server of servers) {
        // Skip private or local IPs if desired, or query all
        try {
          const res = await queryGameServer({
            host: server.ipAddress,
            port: server.port,
            queryPort: server.queryPort || undefined,
            gameSlug: server.gameSlug,
            timeoutMs: 2000,
          });

          if (res.online) {
            await this.serverRepo.updateServerQuery(server.id, {
              isOnline: true,
              name: res.name || server.name,
              mapName: res.mapName || server.mapName,
              gameMode: res.gameMode || server.gameMode,
              currentPlayers: res.currentPlayers,
              maxPlayers: res.maxPlayers || server.maxPlayers,
              details: {
                ...(server.details || {}),
                players: res.players,
                rules: res.rules,
                ping: res.ping,
                queryProtocol: res.protocol,
                queryPort: res.queryPort,
                lastQueried: new Date().toISOString(),
              },
            });
            updatedCount++;
          } else {
            // Only set offline if last heartbeat/query is stale (> 90 seconds)
            const lastActive = server.lastHeartbeat ? new Date(server.lastHeartbeat).getTime() : 0;
            const isStale = Date.now() - lastActive > 90000;

            if (isStale && server.isOnline) {
              await this.serverRepo.setOnlineStatus(server.id, false);
              updatedCount++;
            }
          }
        } catch {
          // Ignore individual server query errors
        }
      }

      return updatedCount;
    } catch {
      return 0;
    }
  }
}
