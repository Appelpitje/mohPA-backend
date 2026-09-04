export type ClientType = 'client' | 'server' | 'dedicated' | (string & {});

export interface FeslSessionData {
  lkey: string;
  userId: string | number;
  personaId?: string | number;
  username: string;
  personaName?: string;
  clientType: ClientType;
  ip: string;
  gameSlug?: string;
  subHost?: string;
  sku?: string;
  locale?: string;
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;
}

export interface PersonaInfo {
  personaId: string | number;
  userId: string | number;
  name: string;
  gameSlug?: string;
  namespace?: string;
  isActive?: boolean;
  createdAt?: string | number;
}

export interface UserAccountInfo {
  userId: string | number;
  username: string;
  email: string;
  country?: string;
  language?: string;
  dobDay?: number;
  dobMonth?: number;
  dobYear?: number;
  zipCode?: string;
  isAdmin?: boolean;
  isBanned?: boolean;
}
