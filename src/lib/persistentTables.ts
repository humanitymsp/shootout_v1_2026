/**
 * Persistent Table Management
 * 
 * Manages persistent tables that survive reset days and support public signups.
 * Uses localStorage for fast local access with backend sync for cross-device access.
 */

import type { PersistentTable, PersistentTableWaitlist } from '../types';
import { log, logWarn, logError } from './logger';

const PERSISTENT_TABLES_KEY = 'persistent-tables';
const PERSISTENT_WAITLIST_KEY = 'persistent-waitlist';
const PERSISTENT_SYNC_CHANNEL = 'persistent-tables-sync';

/**
 * Generate a unique ID for persistent tables
 */
function generatePersistentTableId(): string {
  return `persistent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique ID for waitlist entries
 */
function generateWaitlistId(): string {
  return `waitlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get all persistent tables
 */
export function getPersistentTables(): PersistentTable[] {
  try {
    const stored = localStorage.getItem(PERSISTENT_TABLES_KEY);
    if (!stored) return [];
    const tables = JSON.parse(stored);
    // Migrate old camelCase fields to snake_case
    return tables.map((t: any) => ({
      ...t,
      stakes_text: t.stakes_text || t.stakesText || '',
      seats_total: t.seats_total ?? t.seatsTotal ?? 9,
      bomb_pot_count: t.bomb_pot_count ?? t.bombPotCount ?? 1,
      lockout_count: t.lockout_count ?? t.lockoutCount ?? 0,
      buy_in_limits: t.buy_in_limits || t.buyInLimits || '',
      game_type: t.game_type || t.gameType || 'NLH',
      table_number: t.table_number ?? t.tableNumber ?? 0,
    }));
  } catch (error) {
    logError('Failed to get persistent tables', error);
    return [];
  }
}

/**
 * Save persistent tables to localStorage
 */
export function savePersistentTables(tables: PersistentTable[]): void {
  try {
    localStorage.setItem(PERSISTENT_TABLES_KEY, JSON.stringify(tables));
    log(`💾 Saved ${tables.length} persistent tables`);
    
    // Broadcast changes to other windows/tabs
    broadcastPersistentTableUpdate();
    // Sync to DB for cross-device access (fire-and-forget)
    syncPersistentTablesToDB().catch(() => {});
  } catch (error) {
    logError('Failed to save persistent tables', error);
  }
}

/**
 * Create a new persistent table
 */
export function createPersistentTable(tableData: Omit<PersistentTable, 'id' | 'created_at' | 'updated_at' | 'public_waitlist'>): PersistentTable {
  const tables = getPersistentTables();
  
  const newTable: PersistentTable = {
    ...tableData,
    id: generatePersistentTableId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    public_waitlist: [],
  };
  
  tables.push(newTable);
  savePersistentTables(tables);
  
  log(`🎯 Created persistent table: ${newTable.table_number} - ${newTable.game_type}`);
  return newTable;
}

/**
 * Update a persistent table
 */
export function updatePersistentTable(id: string, updates: Partial<PersistentTable>): PersistentTable | null {
  const tables = getPersistentTables();
  const index = tables.findIndex(t => t.id === id);
  
  if (index === -1) {
    logWarn(`Persistent table not found: ${id}`);
    return null;
  }
  
  tables[index] = {
    ...tables[index],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  
  savePersistentTables(tables);
  log(`🔄 Updated persistent table: ${id}`);
  return tables[index];
}

/**
 * Delete a persistent table
 */
export function deletePersistentTable(id: string): boolean {
  const tables = getPersistentTables();
  const filtered = tables.filter(t => t.id !== id);
  
  if (filtered.length === tables.length) {
    logWarn(`Persistent table not found for deletion: ${id}`);
    return false;
  }
  
  savePersistentTables(filtered);
  
  // Also clean up waitlist entries for this table
  const waitlist = getPersistentWaitlist();
  const filteredWaitlist = waitlist.filter(w => w.persistent_table_id !== id);
  savePersistentWaitlist(filteredWaitlist);
  
  log(`🗑️ Deleted persistent table: ${id}`);
  return true;
}

/**
 * Get waitlist for all persistent tables
 */
export function getPersistentWaitlist(): PersistentTableWaitlist[] {
  try {
    const stored = localStorage.getItem(PERSISTENT_WAITLIST_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    logError('Failed to get persistent waitlist', error);
    return [];
  }
}

/**
 * Save waitlist to localStorage
 */
export function savePersistentWaitlist(waitlist: PersistentTableWaitlist[]): void {
  try {
    localStorage.setItem(PERSISTENT_WAITLIST_KEY, JSON.stringify(waitlist));
    log(`💾 Saved ${waitlist.length} waitlist entries`);
    
    // Broadcast changes to other windows/tabs
    broadcastPersistentTableUpdate();
    // Sync to DB for cross-device access (fire-and-forget)
    syncPersistentTablesToDB().catch(() => {});
  } catch (error) {
    logError('Failed to save persistent waitlist', error);
  }
}

/**
 * Add player to persistent table waitlist
 */
export function addToPersistentWaitlist(persistentTableId: string, playerName: string, playerPhone: string): PersistentTableWaitlist | null {
  const waitlist = getPersistentWaitlist();
  const table = getPersistentTables().find(t => t.id === persistentTableId);
  
  if (!table) {
    logError(`Cannot add to waitlist: persistent table not found: ${persistentTableId}`);
    return null;
  }
  
  if (!table.public_signups) {
    logError(`Cannot add to waitlist: table does not allow public signups: ${persistentTableId}`);
    return null;
  }
  
  // Check if player is already on waitlist
  const existingEntry = waitlist.find(w => 
    w.persistent_table_id === persistentTableId && 
    w.player_phone === playerPhone && 
    !w.removed_at
  );
  
  if (existingEntry) {
    logWarn(`Player already on waitlist: ${playerName} (${playerPhone})`);
    return null;
  }
  
  // Calculate position (highest current position + 1)
  const activeWaitlist = waitlist.filter(w => 
    w.persistent_table_id === persistentTableId && !w.removed_at
  );
  const position = activeWaitlist.length + 1;
  
  const newEntry: PersistentTableWaitlist = {
    id: generateWaitlistId(),
    persistent_table_id: persistentTableId,
    player_name: playerName.trim(),
    player_phone: playerPhone.trim(),
    position,
    added_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  
  waitlist.push(newEntry);
  savePersistentWaitlist(waitlist);
  
  // Update table waitlist count
  updatePersistentTable(persistentTableId, { waitlist_count: position });
  
  log(`✅ Added ${playerName} to waitlist for table ${table.table_number} at position ${position}`);
  return newEntry;
}

/**
 * Remove player from persistent table waitlist
 */
export function removeFromPersistentWaitlist(waitlistId: string): boolean {
  const waitlist = getPersistentWaitlist();
  const entry = waitlist.find(w => w.id === waitlistId);
  
  if (!entry) {
    logWarn(`Waitlist entry not found: ${waitlistId}`);
    return false;
  }
  
  // Mark as removed instead of deleting to maintain history
  entry.removed_at = new Date().toISOString();
  savePersistentWaitlist(waitlist);
  
  // Recalculate positions for remaining players
  recalculateWaitlistPositions(entry.persistent_table_id);
  
  log(`❌ Removed ${entry.player_name} from waitlist`);
  return true;
}

/**
 * Get waitlist for a specific persistent table
 */
export function getTableWaitlist(persistentTableId: string): PersistentTableWaitlist[] {
  const waitlist = getPersistentWaitlist();
  return waitlist
    .filter(w => w.persistent_table_id === persistentTableId && !w.removed_at)
    .sort((a, b) => a.position - b.position);
}

/**
 * Recalculate waitlist positions after removal
 */
function recalculateWaitlistPositions(persistentTableId: string): void {
  const waitlist = getPersistentWaitlist();
  const activeWaitlist = waitlist.filter(w => 
    w.persistent_table_id === persistentTableId && !w.removed_at
  ).sort((a, b) => a.added_at.localeCompare(b.added_at));
  
  // Update positions
  activeWaitlist.forEach((entry, index) => {
    entry.position = index + 1;
  });
  
  savePersistentWaitlist(waitlist);
  
  // Update table waitlist count
  const table = getPersistentTables().find(t => t.id === persistentTableId);
  if (table) {
    updatePersistentTable(persistentTableId, { waitlist_count: activeWaitlist.length });
  }
}

const PERSISTENT_TABLES_SENTINEL = 'persistent-tables-sentinel';
const PERSISTENT_WAITLIST_SENTINEL = 'persistent-waitlist-sentinel';

/**
 * Sync persistent tables + waitlist to DynamoDB for cross-device access.
 * Uses the PlayerSync model with sentinel clubDayId (same pattern as SMS config / pending signups).
 * Fire-and-forget — callers don't need to await.
 */
export async function syncPersistentTablesToDB(): Promise<void> {
  try {
    const { generateClient } = await import('./graphql-client');
    const client = generateClient();

    const tables = getPersistentTables();
    const waitlist = getPersistentWaitlist();

    // Sync tables
    const tablesPayload = JSON.stringify(tables);
    const { data: existingTables } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: PERSISTENT_TABLES_SENTINEL } },
      limit: 1,
      authMode: 'apiKey',
    });
    if (existingTables && existingTables.length > 0) {
      await client.models.PlayerSync.update({
        id: existingTables[0].id,
        playersJson: tablesPayload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    } else {
      await client.models.PlayerSync.create({
        clubDayId: PERSISTENT_TABLES_SENTINEL,
        playersJson: tablesPayload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    }

    // Sync waitlist
    const waitlistPayload = JSON.stringify(waitlist);
    const { data: existingWaitlist } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: PERSISTENT_WAITLIST_SENTINEL } },
      limit: 1,
      authMode: 'apiKey',
    });
    if (existingWaitlist && existingWaitlist.length > 0) {
      await client.models.PlayerSync.update({
        id: existingWaitlist[0].id,
        playersJson: waitlistPayload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    } else {
      await client.models.PlayerSync.create({
        clubDayId: PERSISTENT_WAITLIST_SENTINEL,
        playersJson: waitlistPayload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    }

    log('📡 Synced persistent tables + waitlist to DB');
  } catch (error) {
    logError('Failed to sync persistent tables to DB:', error);
  }
}

/**
 * Fetch persistent tables from DynamoDB (for cross-device access on Public/TV pages).
 * Returns { tables, waitlist } or null if not found.
 */
export async function getPersistentTablesFromDB(): Promise<{ tables: PersistentTable[]; waitlist: PersistentTableWaitlist[] } | null> {
  try {
    const { generateClient } = await import('./graphql-client');
    const client = generateClient();

    const [tablesRes, waitlistRes] = await Promise.all([
      client.models.PlayerSync.list({
        filter: { clubDayId: { eq: PERSISTENT_TABLES_SENTINEL } },
        limit: 1,
        authMode: 'apiKey',
      }),
      client.models.PlayerSync.list({
        filter: { clubDayId: { eq: PERSISTENT_WAITLIST_SENTINEL } },
        limit: 1,
        authMode: 'apiKey',
      }),
    ]);

    let tables: PersistentTable[] = [];
    let waitlist: PersistentTableWaitlist[] = [];

    if (tablesRes.data && tablesRes.data.length > 0 && tablesRes.data[0].playersJson) {
      tables = JSON.parse(tablesRes.data[0].playersJson as string);
    }
    if (waitlistRes.data && waitlistRes.data.length > 0 && waitlistRes.data[0].playersJson) {
      waitlist = JSON.parse(waitlistRes.data[0].playersJson as string);
    }

    return { tables, waitlist };
  } catch (error) {
    logError('Failed to fetch persistent tables from DB:', error);
    return null;
  }
}

/**
 * Broadcast persistent table updates to other windows/tabs
 */
function broadcastPersistentTableUpdate(): void {
  try {
    const channel = new BroadcastChannel(PERSISTENT_SYNC_CHANNEL);
    channel.postMessage({ type: 'persistent-tables-updated', timestamp: Date.now() });
    channel.close();
  } catch (error) {
    // BroadcastChannel not supported in some browsers
    logWarn('BroadcastChannel not supported', error);
  }
}

/**
 * Listen for persistent table updates from other windows/tabs
 */
export function listenForPersistentTableUpdates(callback: () => void): () => void {
  try {
    const channel = new BroadcastChannel(PERSISTENT_SYNC_CHANNEL);
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'persistent-tables-updated') {
        callback();
      }
    };
    
    channel.addEventListener('message', handleMessage);
    
    // Return cleanup function
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  } catch (error) {
    // BroadcastChannel not supported
    logWarn('BroadcastChannel not supported', error);
    return () => {}; // No-op cleanup
  }
}
