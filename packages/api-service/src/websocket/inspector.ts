/**
 * CentralSpy WebSocket Live Protocol Inspector Hub
 */

import { WebSocket } from 'ws';
import { PacketInspectorEvent } from '@centralspy/shared';

export interface InspectorFilter {
  protocol?: 'FESL' | 'THEATER';
  direction?: 'INCOMING' | 'OUTGOING';
  subsystem?: string;
  clientIp?: string;
  gameSlug?: string;
}

interface InspectorClient {
  ws: WebSocket;
  filter: InspectorFilter;
  connectedAt: Date;
}

export class InspectorHub {
  private clients: Set<InspectorClient> = new Set();
  private packetHistory: PacketInspectorEvent[] = [];
  private maxHistoryLength = 500;

  /**
   * Registers a new WebSocket connection to the inspector.
   */
  public handleConnection(ws: WebSocket): void {
    const client: InspectorClient = {
      ws,
      filter: {},
      connectedAt: new Date()
    };

    this.clients.add(client);

    // Send initial welcome & stats
    this.sendJson(ws, {
      type: 'CONNECTED',
      message: 'CentralSpy Live Packet Inspector Connected',
      historyCount: this.packetHistory.length,
      activeClients: this.clients.size
    });

    // Send recent history buffer (up to 50 recent packets)
    const recent = this.packetHistory.slice(-50);
    for (const pkt of recent) {
      this.sendJson(ws, { type: 'PACKET', data: pkt });
    }

    ws.on('message', (data: Buffer | string) => {
      try {
        const str = typeof data === 'string' ? data : data.toString('utf8');
        const msg = JSON.parse(str);

        if (msg.action === 'filter') {
          client.filter = msg.filter || {};
          this.sendJson(ws, { type: 'FILTER_UPDATED', filter: client.filter });
        } else if (msg.action === 'clear_history') {
          this.packetHistory = [];
          this.sendJson(ws, { type: 'HISTORY_CLEARED' });
        } else if (msg.action === 'ping') {
          this.sendJson(ws, { type: 'PONG', timestamp: Date.now() });
        }
      } catch (err: any) {
        this.sendJson(ws, { type: 'ERROR', message: err.message });
      }
    });

    ws.on('close', () => {
      this.clients.delete(client);
    });

    ws.on('error', (err) => {
      console.error('[InspectorHub] WebSocket error:', err.message);
      this.clients.delete(client);
    });
  }

  /**
   * Broadcasts a protocol packet event to all connected clients matching filters.
   */
  public broadcastPacket(event: PacketInspectorEvent): void {
    // Add to circular history buffer
    this.packetHistory.push(event);
    if (this.packetHistory.length > this.maxHistoryLength) {
      this.packetHistory.shift();
    }

    const payload = JSON.stringify({ type: 'PACKET', data: event });

    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      if (this.matchesFilter(event, client.filter)) {
        try {
          client.ws.send(payload);
        } catch (err: any) {
          console.error('[InspectorHub] Failed to send to client:', err.message);
        }
      }
    }
  }

  /**
   * Checks if an event matches a client filter.
   */
  private matchesFilter(event: PacketInspectorEvent, filter: InspectorFilter): boolean {
    if (filter.protocol && event.protocol !== filter.protocol) {
      return false;
    }
    if (filter.direction && event.direction !== filter.direction) {
      return false;
    }
    if (filter.subsystem && !event.subsystemOrCommand.toLowerCase().includes(filter.subsystem.toLowerCase())) {
      return false;
    }
    if (filter.clientIp && event.clientIp !== filter.clientIp) {
      return false;
    }
    return true;
  }

  private sendJson(ws: WebSocket, obj: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  /**
   * Gets stats on active inspector connections.
   */
  public getStats() {
    return {
      connectedClients: this.clients.size,
      totalBufferedPackets: this.packetHistory.length
    };
  }
}

let globalInspectorHub: InspectorHub | null = null;

export function getInspectorHub(): InspectorHub {
  if (!globalInspectorHub) {
    globalInspectorHub = new InspectorHub();
  }
  return globalInspectorHub;
}
