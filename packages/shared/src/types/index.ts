/**
 * CentralSpy Shared Type Definitions
 */

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  countryCode: string;
  dob: string; // YYYY-MM-DD
  isAdmin: boolean;
  isBanned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDemographics {
  countryCode?: string;
  dob?: string;
  email?: string;
  zipCode?: string;
  language?: string;
}

export interface Persona {
  id: string;
  userId: string;
  gameSlug: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
}

export interface Entitlement {
  id: string;
  userId: string;
  gameSlug: string;
  cdKey: string;
  isUsed: boolean;
  activatedAt: Date | null;
}

export interface GameServer {
  id: string;
  name: string;
  gameSlug: string;
  ipAddress: string;
  port: number;
  queryPort: number;
  secretKey: string;
  isRanked: boolean;
  isOnline: boolean;
  lastHeartbeat: Date;
  maxPlayers?: number;
  currentPlayers?: number;
  mapName?: string;
  gameMode?: string;
  subState?: string;
  details?: Record<string, any>;
}

export interface PersonaStats {
  personaId: string;
  score: number;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  timePlayedSeconds: number;
  customStats: Record<string, any>;
}

export interface MatchHistory {
  id: string;
  serverId: string | null;
  gameSlug: string;
  mapName: string;
  gameMode: string;
  durationSeconds: number;
  winnerTeam: number | null;
  details: Record<string, any>;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, any>;
  createdAt: Date;
}

export interface FeslHeader {
  subsystem: string; // 4-char string, e.g. "fsys", "acct", "subs", "dobj", "rank", "pnow"
  subtype: number;   // 32-bit integer, e.g. 0x00000001 (req), 0x80000001 (resp), 0xC0000001 (event)
  packetLength: number; // 12 bytes header + payload length
}

export interface FeslPacket {
  subsystem: string;
  subtype: number;
  packetLength: number;
  payload: Record<string, any>;
  rawPayload?: string;
}

export interface TheaterPacket {
  command: string; // e.g. "CONN", "USER", "LLST", "GLST", "CGAM", "EGAM", "EGRQ", "EGRS", "PENT", "UPLA", "ECHO", "PING", "KICK", "ECNL"
  txnId: number;
  packetLength: number;
  payload: Record<string, any>;
  rawPayload?: string;
}

export interface SessionData {
  lkey: string;
  userId: string;
  username: string;
  personaId?: string;
  personaName?: string;
  clientType: 'client' | 'server' | 'dedicated';
  ip: string;
  gameSlug: string;
  macAddr?: string;
  sku?: string;
  locale?: string;
  theaterPort?: number;
  createdAt: number;
  expiresAt: number;
}

export interface PingSiteConfig {
  name: string;
  addr: string;
  port: number;
  type: number;
}

export interface GameConfig {
  slug: string;
  name: string;
  domainPartition: string;
  subPartition?: string;
  defaultTheaterPort: number;
  defaultFeslPort: number;
  skus: string[];
  maxPersonasPerUser: number;
  secretSalt?: string;
  pingSites?: PingSiteConfig[];
  supportedFeatures?: {
    hasGameSpyPreAuth?: boolean;
    hasTelemetry?: boolean;
    hasNuLogin?: boolean;
    hasSubAccounts?: boolean;
    usesDoubleQuotes?: boolean;
  };
}

export interface PacketInspectorEvent {
  id: string;
  timestamp: number;
  protocol: 'FESL' | 'THEATER';
  direction: 'INCOMING' | 'OUTGOING';
  clientIp: string;
  clientPort: number;
  subsystemOrCommand: string;
  subtypeOrTxn: string | number;
  length: number;
  payload: Record<string, any> | string;
  rawHex?: string;
}

export interface FeslErrorItem {
  fieldName: string;
  fieldError: number | string;
  message?: string;
}
