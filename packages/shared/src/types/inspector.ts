export interface InspectorPacketEvent {
  id: string;
  timestamp: number;
  direction: 'in' | 'out';
  subsystem: string;
  packetType: number;
  packetTypeHex: string;
  length: number;
  txn?: string;
  connectionId: string;
  remoteAddress: string;
  remotePort: number;
  clientType?: string;
  lkey?: string;
  username?: string;
  personaName?: string;
  payload: Record<string, any>;
  rawPayload: string;
}

export interface InspectorConnectionEvent {
  connectionId: string;
  remoteAddress: string;
  remotePort: number;
  serverPort: number;
  isTls: boolean;
  timestamp: number;
  type: 'connected' | 'disconnected' | 'error';
  reason?: string;
}
