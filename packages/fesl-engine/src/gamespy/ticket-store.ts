export interface GsPreauthRecord {
  ticket: string;
  challenge: string;
  lkey: string;
  userId: string | number;
  username: string;
  createdAt: number;
}

const tickets = new Map<string, GsPreauthRecord>();

export function saveGsPreauth(record: Omit<GsPreauthRecord, 'createdAt'>): GsPreauthRecord {
  const stored: GsPreauthRecord = { ...record, createdAt: Date.now() };
  tickets.set(record.ticket, stored);
  return stored;
}

export function getGsPreauth(ticket: string): GsPreauthRecord | undefined {
  return tickets.get(ticket);
}

export function toGsNumericId(id: string | number): number {
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
    return Math.floor(id);
  }
  const asString = String(id);
  if (/^\d+$/.test(asString)) {
    return parseInt(asString, 10) || 1;
  }
  let hash = 0;
  for (let i = 0; i < asString.length; i++) {
    hash = (Math.imul(31, hash) + asString.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) % 2000000000 || 1;
}
