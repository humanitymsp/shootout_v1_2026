import { log, logError } from './logger';

const STORAGE_KEY = 'pending-waitlist-signups';
const PENDING_SIGNUPS_SENTINEL = 'pending-signups-sentinel';
const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export interface PendingSignup {
  token: string;
  tableId: string;
  tableNumber: number;
  clubDayId: string;
  playerName: string;
  playerPhone: string;
  gameType: string;
  stakesText: string;
  createdAt: string;
  expiresAt: string;
}

function generateToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function getAllPendingLocal(): PendingSignup[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function savePendingLocal(entries: PendingSignup[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function purgeExpiredLocal(): void {
  const now = new Date().toISOString();
  const entries = getAllPendingLocal().filter(e => e.expiresAt > now);
  savePendingLocal(entries);
}

// ---- DynamoDB sync (cross-device) ----

async function getClient() {
  const { generateClient } = await import('./graphql-client');
  return generateClient();
}

/**
 * Sync pending signups to DynamoDB for admin visibility on other devices.
 */
async function syncPendingToDB(entries: PendingSignup[]): Promise<void> {
  try {
    const client = await getClient();
    const payload = JSON.stringify(entries);
    const { data: existing } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: PENDING_SIGNUPS_SENTINEL } },
      limit: 1,
      authMode: 'apiKey',
    });
    if (existing && existing.length > 0) {
      await client.models.PlayerSync.update({
        id: existing[0].id,
        playersJson: payload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    } else {
      await client.models.PlayerSync.create({
        clubDayId: PENDING_SIGNUPS_SENTINEL,
        playersJson: payload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    }
  } catch (error) {
    logError('[PendingSignup] Failed to sync to DB:', error);
  }
}

/**
 * Read pending signups from DynamoDB. Used by admin page on other devices.
 */
export async function getPendingSignupsFromDB(): Promise<PendingSignup[]> {
  try {
    const client = await getClient();
    const { data } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: PENDING_SIGNUPS_SENTINEL } },
      limit: 1,
      authMode: 'apiKey',
    });
    if (data && data.length > 0) {
      const parsed: PendingSignup[] = typeof data[0].playersJson === 'string'
        ? JSON.parse(data[0].playersJson)
        : data[0].playersJson;
      const now = new Date().toISOString();
      return (parsed || []).filter(e => e.expiresAt > now);
    }
  } catch (error) {
    logError('[PendingSignup] Failed to read from DB:', error);
  }
  return [];
}

/**
 * Remove a pending signup from DynamoDB by token.
 */
export async function removePendingSignupFromDB(token: string): Promise<void> {
  try {
    const all = await getPendingSignupsFromDB();
    const filtered = all.filter(e => e.token !== token);
    await syncPendingToDB(filtered);
    log(`[PendingSignup] Removed token ${token.slice(0, 8)}... from DB`);
  } catch (error) {
    logError('[PendingSignup] Failed to remove from DB:', error);
  }
}

// ---- Public API ----

/**
 * Create a pending signup and return the token.
 * Saves to both localStorage (for confirm page on same device) and DynamoDB (for admin on other devices).
 */
export async function createPendingSignup(params: {
  tableId: string;
  tableNumber: number;
  clubDayId: string;
  playerName: string;
  playerPhone: string;
  gameType: string;
  stakesText: string;
}): Promise<PendingSignup> {
  purgeExpiredLocal();

  // Use DynamoDB as source of truth so stale local entries can't be re-synced
  const existing = await getPendingSignupsFromDB();
  const normalizedPhone = params.playerPhone.replace(/\D/g, '');
  const dup = existing.find(
    e => e.playerPhone.replace(/\D/g, '') === normalizedPhone && e.tableId === params.tableId
  );
  if (dup) {
    log('[PendingSignup] Duplicate found, returning existing token');
    // Keep local cache aligned with DB snapshot
    savePendingLocal(existing);
    return dup;
  }

  const now = new Date();
  const token = generateToken();
  const entry: PendingSignup = {
    token,
    ...params,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOKEN_EXPIRY_MS).toISOString(),
  };

  existing.push(entry);
  log(`[PendingSignup] Created token ${token.slice(0, 8)}... for ${params.playerName} at Table ${params.tableNumber}`);

  // Sync to DynamoDB for admin visibility
  await syncPendingToDB(existing);

  // Keep local cache aligned with DB snapshot
  savePendingLocal(existing);

  return entry;
}

/**
 * Look up a pending signup by token from localStorage.
 * Falls back to DynamoDB if not found locally (e.g. confirm page opened on different device).
 */
export async function getPendingSignup(token: string): Promise<PendingSignup | null> {
  purgeExpiredLocal();
  const local = getAllPendingLocal().find(e => e.token === token);
  if (local && new Date(local.expiresAt) >= new Date()) return local;

  // Fallback: check DynamoDB
  const dbEntries = await getPendingSignupsFromDB();
  const dbEntry = dbEntries.find(e => e.token === token);
  if (dbEntry && new Date(dbEntry.expiresAt) >= new Date()) return dbEntry;

  return null;
}

/**
 * Remove a pending signup after confirmation — from both localStorage and DynamoDB.
 */
export async function removePendingSignup(token: string): Promise<void> {
  const entries = getAllPendingLocal().filter(e => e.token !== token);
  savePendingLocal(entries);
  log(`[PendingSignup] Removed token ${token.slice(0, 8)}... from local`);
  await removePendingSignupFromDB(token);
}
