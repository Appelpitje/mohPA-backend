import { WebSocketServer, WebSocket } from 'ws';
import { InspectorPacketEvent, InspectorConnectionEvent } from '@mohpa/shared';
import { config } from '../config/config.js';
import { redactSensitive, redactSensitiveString } from '../utils/redact.js';

export class InspectorHub {
  private static instance: InspectorHub;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private recentPackets: InspectorPacketEvent[] = [];
  private maxHistory = 200;

  private constructor() {}

  public static getInstance(): InspectorHub {
    if (!InspectorHub.instance) {
      InspectorHub.instance = new InspectorHub();
    }
    return InspectorHub.instance;
  }

  public start(port: number = config.inspectorPort): void {
    if (this.wss) return;

    try {
      this.wss = new WebSocketServer({ port, host: config.host }, () => {
        console.log(`[InspectorHub] WebSocket inspector listening on ws://${config.host}:${port}`);
      });

      this.wss.on('connection', (ws: WebSocket) => {
        this.clients.add(ws);

        // Send recent packet history on connect
        const initMessage = JSON.stringify({
          type: 'history',
          packets: this.recentPackets,
        });
        ws.send(initMessage);

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        ws.on('error', () => {
          this.clients.delete(ws);
        });
      });

      this.wss.on('error', (err) => {
        console.warn(`[InspectorHub] WebSocket server error: ${err.message}`);
      });
    } catch (err) {
      console.warn(`[InspectorHub] Failed to start WebSocket inspector: ${(err as Error).message}`);
    }
  }

  /**
   * Broadcasts a packet event to all connected inspector UI clients.
   */
  public broadcastPacket(event: InspectorPacketEvent): void {
    const sanitized: InspectorPacketEvent = {
      ...event,
      lkey: event.lkey ? '[REDACTED]' : event.lkey,
      payload: redactSensitive(event.payload) as Record<string, any>,
      rawPayload: redactSensitiveString(event.rawPayload || ''),
    };

    // Add to ring buffer
    this.recentPackets.push(sanitized);
    if (this.recentPackets.length > this.maxHistory) {
      this.recentPackets.shift();
    }

    if (this.clients.size === 0) return;

    const payload = JSON.stringify({
      type: 'packet',
      data: sanitized,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Broadcasts a connection event to inspector UI clients.
   */
  public broadcastConnection(event: InspectorConnectionEvent): void {
    if (this.clients.size === 0) return;

    const payload = JSON.stringify({
      type: 'connection',
      data: event,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public getHistory(): InspectorPacketEvent[] {
    return [...this.recentPackets];
  }

  public close(): void {
    if (this.wss) {
      for (const client of this.clients) {
        try {
          client.terminate();
        } catch {}
      }
      this.wss.close();
      this.wss = null;
      this.clients.clear();
    }
  }
}

