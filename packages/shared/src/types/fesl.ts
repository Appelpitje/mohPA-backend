export type FeslSubsystem =
  | 'fsys'
  | 'acct'
  | 'subs'
  | 'dobj'
  | 'rank'
  | 'gsum'
  | 'pnow'
  | 'CONN'
  | 'USER'
  | 'LLST'
  | 'GLST'
  | 'GDAT'
  | 'CGAM'
  | 'EGAM'
  | 'EGRQ'
  | 'EGRS'
  | 'PENT'
  | 'UPLA'
  | 'ECHO'
  | 'PING'
  | 'KICK'
  | 'ECNL'
  | (string & {});

export const FESL_SUBSYSTEMS = {
  FSYS: 'fsys',
  ACCT: 'acct',
  SUBS: 'subs',
  DOBJ: 'dobj',
  RANK: 'rank',
  GSUM: 'gsum',
  PNOW: 'pnow',
} as const;

export const THEATER_SUBSYSTEMS = {
  CONN: 'CONN',
  USER: 'USER',
  LLST: 'LLST',
  GLST: 'GLST',
  GDAT: 'GDAT',
  CGAM: 'CGAM',
  EGAM: 'EGAM',
  EGRQ: 'EGRQ',
  EGRS: 'EGRS',
  PENT: 'PENT',
  UPLA: 'UPLA',
  ECHO: 'ECHO',
  PING: 'PING',
  KICK: 'KICK',
  ECNL: 'ECNL',
} as const;

export const FESL_PACKET_FLAGS = {
  REQUEST: 0x00000000,
  RESPONSE_MASK: 0x80000000,
  NOTIFICATION_MASK: 0xc0000000,
} as const;

export const FESL_TXN = {
  // fsys
  HELLO: 'Hello',
  PING: 'Ping',
  MEM_CHECK: 'MemCheck',
  GET_PING_SITES: 'GetPingSites',
  GOODBYE: 'Goodbye',

  // acct
  LOGIN: 'Login',
  NU_LOGIN: 'NuLogin',
  NU_GET_PERSONAS: 'NuGetPersonas',
  GET_PERSONAS: 'GetPersonas',
  NU_LOGIN_PERSONA: 'NuLoginPersona',
  LOGIN_PERSONA: 'LoginPersona',
  GET_SUB_ACCOUNTS: 'GetSubAccounts',
  LOGIN_SUB_ACCOUNT: 'LoginSubAccount',
  ADD_SUB_ACCOUNT: 'AddSubAccount',
  DISABLE_SUB_ACCOUNT: 'DisableSubAccount',
  GET_ACCOUNT: 'GetAccount',
  UPDATE_ACCOUNT: 'UpdateAccount',
  NU_LOOKUP_USER_INFO: 'NuLookupUserInfo',
  NU_LOOKUP_PERSONA: 'NuLookupPersona',
  NU_LOOKUP_PERSONA_BY_NAME: 'NuLookupPersonaByName',
  GAME_SPY_PRE_AUTH: 'GameSpyPreAuth',
  GET_TELEMETRY_TOKEN: 'GetTelemetryToken',

  // subs & dobj
  GET_ENTITLEMENT_BY_BUNDLE: 'GetEntitlementByBundle',
  GET_OBJECT_INVENTORY: 'GetObjectInventory',

  // rank & gsum
  GET_STATS: 'GetStats',
  UPDATE_STATS: 'UpdateStats',
  GET_SESSION_ID: 'GetSessionID',
  GET_GAME_SUMMARY: 'GetGameSummary',

  // pnow
  START: 'Start',
  STATUS: 'Status',
} as const;

export interface FeslErrorDetail {
  fieldName: string;
  fieldError: string;
  fieldErrorCode?: number | string;
}

export interface FeslErrorResponse {
  TXN: string;
  errorContainer?: FeslErrorDetail[];
  [key: string]: any;
}
