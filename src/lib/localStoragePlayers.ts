/**
 * LocalStorage-based Player Management with Cross-Device Sync
 * 
 * Stores players in localStorage for fast local access.
 * Syncs to backend for cross-device access (TV, tablet, public views).
 * Uses BroadcastChannel + localStorage events for same-device sync.
 * Auto-resets daily.
 */

import type { Player } from '../types';
import { log, logWarn, logError } from './logger';
import { getCurrentBusinessDayId } from './businessDay';

const PLAYERS_STORAGE_PREFIX = 'daily-players-';
const CURRENT_DAY_KEY = 'current-players-day';
const PLAYERS_SYNC_CHANNEL = 'players-sync';
const PLAYERS_STORAGE_EVENT_KEY = 'players-updated';

/**
 * Get the current business day ID (respects 9am-3am boundary)
 */
function getBusinessDayString(): string {
  return getCurrentBusinessDayId();
}

/**
 * Get the storage key for the current business day's players
 */
function getTodayStorageKey(): string {
  return `${PLAYERS_STORAGE_PREFIX}${getBusinessDayString()}`;
}

/**
 * Check if we need to reset (new business day, not calendar day)
 * Business day boundary: 9:00 AM - 3:00 AM next calendar day
 */
function checkAndResetIfNewDay(): void {
  const storedDay = localStorage.getItem(CURRENT_DAY_KEY);
  const today = getBusinessDayString();
  
  if (storedDay !== today) {
    // New business day - clear old player data
    if (storedDay) {
      const oldKey = `${PLAYERS_STORAGE_PREFIX}${storedDay}`;
      localStorage.removeItem(oldKey);
      log(`🗑️ Cleared players from previous business day: ${storedDay}`);
    }
    localStorage.setItem(CURRENT_DAY_KEY, today);
    log(`📅 New business day detected: ${today}`);
  }
}

/**
 * Get all players for today
 */
function getTodayPlayers(): Player[] {
  checkAndResetIfNewDay();
  const key = getTodayStorageKey();
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  
  try {
    return JSON.parse(stored);
  } catch (error) {
    logWarn('Error parsing stored players:', error);
    return [];
  }
}

/**
 * Save players for today and sync to other tabs/devices
 */
function saveTodayPlayers(players: Player[], syncToBackend = true, clubDayId?: string): void {
  checkAndResetIfNewDay();
  const key = getTodayStorageKey();
  localStorage.setItem(key, JSON.stringify(players));
  
  // Sync to other tabs via BroadcastChannel
  try {
    const channel = new BroadcastChannel(PLAYERS_SYNC_CHANNEL);
    channel.postMessage({
      type: 'players-updated',
      players: players,
      timestamp: Date.now(),
    });
    channel.close();
  } catch (error) {
    // BroadcastChannel not supported, use localStorage event as fallback
    localStorage.setItem(PLAYERS_STORAGE_EVENT_KEY, Date.now().toString());
  }
  
  // Sync to backend for cross-device access (non-blocking)
  if (syncToBackend) {
    syncPlayersToBackend(players, clubDayId).catch(err => {
      logWarn('Failed to sync players to backend (non-critical):', err);
    });
  }
}

/**
 * Sync players to backend for cross-device access
 * Stores as a JSON blob in PlayerSync model for cross-device sync
 */
async function syncPlayersToBackend(players: Player[], clubDayId?: string): Promise<void> {
  if (!clubDayId) {
    log('No clubDayId provided for sync - skipping backend sync');
    return;
  }

  try {
    const syncData = JSON.stringify(players);
    log(`Syncing ${players.length} players to backend for club day ${clubDayId}`);
    
    const { getClient } = await import('./api');
    const client = getClient();
    
    // Guard: check if models are available
    if (!client?.models?.PlayerSync) {
      logWarn('PlayerSync model not available - skipping backend sync');
      return;
    }
    
    // Check if PlayerSync entry exists for this club day
    const { data: existingSyncs } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: clubDayId } },
      authMode: 'apiKey',
    }).catch((error: any) => {
      logWarn('PlayerSync.list failed - model may not exist:', error);
      return { data: [] };
    });
    
    if (existingSyncs && existingSyncs.length > 0) {
      // Update existing sync
      const existingSync = existingSyncs[0];
      await client.models.PlayerSync.update({
        id: existingSync.id,
        playersJson: syncData,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' }).catch((error: any) => {
        logWarn('PlayerSync.update failed - model may not exist:', error);
        throw error;
      });
    } else {
      // Create new sync entry
      await client.models.PlayerSync.create({
        clubDayId,
        playersJson: syncData,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' }).catch((error: any) => {
        logWarn('PlayerSync.create failed - model may not exist:', error);
        throw error;
      });
    }
    
    // Also store in localStorage for fast local access
    const syncKey = `players-sync-${clubDayId}`;
    localStorage.setItem(syncKey, JSON.stringify({
      players,
      syncedAt: new Date().toISOString(),
      clubDayId,
    }));
    
    // Broadcast to other tabs
    try {
      const channel = new BroadcastChannel(PLAYERS_SYNC_CHANNEL);
      channel.postMessage({
        type: 'players-synced-backend',
        clubDayId,
        players,
        timestamp: Date.now(),
      });
      channel.close();
    } catch (error) {
      // BroadcastChannel not supported
    }
    
    log(`✅ Synced ${players.length} players to backend for club day ${clubDayId}`);
  } catch (error) {
    logError('Error syncing players to backend:', error);
    // Don't throw - sync failure shouldn't break the app
    // Fallback to localStorage only
    if (clubDayId) {
      const syncKey = `players-sync-${clubDayId}`;
      localStorage.setItem(syncKey, JSON.stringify({
        players,
        syncedAt: new Date().toISOString(),
        clubDayId,
      }));
    }
  }
}

/**
 * Load players from backend sync (for TV/tablet/public views)
 * Fetches from PlayerSync model for cross-device access
 */
export async function loadPlayersFromBackend(clubDayId: string): Promise<Player[]> {
  try {
    // Dynamically import to avoid circular dependency
    const { getClient } = await import('./api');
    const client = getClient();

    // Guard: if Amplify hasn't been configured yet, fall through to localStorage cache
    if (!client?.models?.PlayerSync) {
      const syncKey = `players-sync-${clubDayId}`;
      const cached = localStorage.getItem(syncKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.players && Array.isArray(parsed.players)) return parsed.players as Player[];
        } catch {}
      }
      return getTodayPlayers();
    }

    // Try to fetch from backend PlayerSync model
    const { data: syncEntries } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: clubDayId } },
    });
    
    if (syncEntries && syncEntries.length > 0) {
      const latestSync = syncEntries[0]; // Should only be one per club day
      const syncData = latestSync.playersJson as any;
      
      if (syncData && syncData.players && Array.isArray(syncData.players)) {
        // Update localStorage cache
        const syncKey = `players-sync-${clubDayId}`;
        localStorage.setItem(syncKey, JSON.stringify(syncData));
        
        // Merge with local players (local is source of truth - backend sync may be stale)
        const localPlayers = getTodayPlayers();
        const syncedPlayers = syncData.players as Player[];
        
        // Create a map: local players first (source of truth), synced fills in any gaps
        const merged = new Map<string, Player>();
        syncedPlayers.forEach((p: Player) => merged.set(p.id, p));
        // Local always wins - overwrites synced for same ID, and adds any new local players
        localPlayers.forEach((p: Player) => merged.set(p.id, p));
        
        const mergedArray = Array.from(merged.values());
        log(`📥 Loaded ${syncedPlayers.length} players from backend sync, ${localPlayers.length} local = ${mergedArray.length} total`);
        
        // Update local storage with merged data
        saveTodayPlayers(mergedArray, false); // Don't sync back (we're receiving)
        return mergedArray;
      }
    }
    
    // Fallback to localStorage cache
    const syncKey = `players-sync-${clubDayId}`;
    const syncData = localStorage.getItem(syncKey);
    if (syncData) {
      try {
        const parsed = JSON.parse(syncData);
        if (parsed.players && Array.isArray(parsed.players)) {
          return parsed.players as Player[];
        }
      } catch (error) {
        logWarn('Error parsing localStorage sync data:', error);
      }
    }
    
    // If no sync data, return local players (might be empty on TV/tablet)
    return getTodayPlayers();
  } catch (error) {
    logError('Error loading players from backend:', error);
    // Fallback to localStorage
    const syncKey = `players-sync-${clubDayId}`;
    const syncData = localStorage.getItem(syncKey);
    if (syncData) {
      try {
        const parsed = JSON.parse(syncData);
        if (parsed.players && Array.isArray(parsed.players)) {
          return parsed.players as Player[];
        }
      } catch (error) {
        // Ignore
      }
    }
    return getTodayPlayers(); // Final fallback
  }
}

/**
 * Start polling for player updates (for TV/tablet/public views)
 * Call this to keep players in sync with admin device
 */
export function startPlayerSyncPolling(clubDayId: string, callback: (players: Player[]) => void, intervalMs = 2000): () => void {
  let intervalId: number | null = null;
  
  const poll = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const players = await loadPlayersFromBackend(clubDayId);
    callback(players);
  };
  
  // Poll immediately
  poll();
  
  // Then poll at interval
  intervalId = window.setInterval(poll, intervalMs);
  
  // Also listen for BroadcastChannel updates
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(PLAYERS_SYNC_CHANNEL);
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'players-synced-backend' && event.data?.clubDayId === clubDayId) {
        const players = event.data.players;
        if (Array.isArray(players)) {
          callback(players);
        }
      }
    });
  } catch (error) {
    // BroadcastChannel not supported
  }
  
  // Return cleanup function
  return () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
    if (channel) {
      channel.close();
    }
  };
}

/**
 * Generate a unique player ID
 */
function generatePlayerId(): string {
  // Use timestamp + random to ensure uniqueness
  return `player-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Search players by query (name or nick)
 */
export function searchPlayersLocal(query: string): Player[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  
  const players = getTodayPlayers();
  const lowerQuery = trimmed.toLowerCase();
  
  return players.filter(player => {
    const name = (player.name || '').toLowerCase();
    const nick = (player.nick || '').toLowerCase();
    return name.includes(lowerQuery) || nick.includes(lowerQuery);
  });
}

/**
 * Get a player by ID
 */
export function getPlayerByIdLocal(playerId: string): Player | null {
  const players = getTodayPlayers();
  const found = players.find(p => p.id === playerId);
  if (found) return found;

  // Fallback: scan all players-sync-* keys in localStorage
  // This covers the case where the business day key mismatched and wiped the daily list
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('players-sync-') || key.startsWith('daily-players-')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const list: Player[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.players)
          ? parsed.players
          : [];
        const match = list.find(p => p.id === playerId);
        if (match) return match;
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Create a new player
 */
export function createPlayerLocal(player: {
  name: string;
  nick: string;
  phone?: string;
  email?: string;
}, clubDayId?: string): Player {
  const players = getTodayPlayers();
  
  // Check for duplicate nick (case-insensitive)
  const existing = players.find(
    p => p.nick.toLowerCase() === player.nick.toLowerCase()
  );
  
  if (existing) {
    // Return existing player instead of creating duplicate
    log(`Player "${player.nick}" already exists, returning existing player`);
    return existing;
  }
  
  const newPlayer: Player = {
    id: generatePlayerId(),
    name: player.name,
    nick: player.nick,
    phone: player.phone,
    email: player.email,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  players.push(newPlayer);
  saveTodayPlayers(players, true, clubDayId); // Sync to backend
  
  log(`✅ Created player locally: ${newPlayer.nick} (${newPlayer.id})`);
  return newPlayer;
}

/**
 * Upsert a player with a known ID into localStorage.
 * Used when we already have a DB player record and need to ensure
 * localStorage has it for enrichWithPlayerData lookups.
 */
export function upsertPlayerLocal(player: Player): void {
  const players = getTodayPlayers();
  const idx = players.findIndex(p => p.id === player.id);
  if (idx >= 0) {
    players[idx] = { ...players[idx], ...player };
  } else {
    players.push(player);
  }
  saveTodayPlayers(players, false); // Don't sync back to backend — this came from backend
}

/**
 * Get all players for today
 */
export function getAllPlayersLocal(): Player[] {
  return getTodayPlayers();
}

/**
 * Update a player
 */
export function updatePlayerLocal(playerId: string, updates: Partial<Player>): Player | null {
  const players = getTodayPlayers();
  const index = players.findIndex(p => p.id === playerId);
  
  if (index === -1) return null;
  
  players[index] = {
    ...players[index],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  
  saveTodayPlayers(players);
  return players[index];
}

/**
 * Delete a player (by ID)
 */
export function deletePlayerLocal(playerId: string): boolean {
  const players = getTodayPlayers();
  const filtered = players.filter(p => p.id !== playerId);
  
  if (filtered.length === players.length) return false; // Not found
  
  saveTodayPlayers(filtered);
  return true;
}

/**
 * Initialize - call this on app startup
 * Sets up listeners for cross-tab sync
 */
export function initializeLocalPlayers(): void {
  checkAndResetIfNewDay();
  const players = getTodayPlayers();
  log(`📋 Loaded ${players.length} players for today`);
  
  // Listen for player updates from other tabs
  try {
    const channel = new BroadcastChannel(PLAYERS_SYNC_CHANNEL);
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'players-updated') {
        const updatedPlayers = event.data.players;
        if (Array.isArray(updatedPlayers)) {
          // Merge incoming with local - local wins to prevent stale sync from overwriting new players
          const localPlayers = getTodayPlayers();
          const merged = new Map<string, Player>();
          updatedPlayers.forEach((p: Player) => merged.set(p.id, p));
          localPlayers.forEach((p: Player) => merged.set(p.id, p)); // local wins
          const mergedArray = Array.from(merged.values());
          const key = getTodayStorageKey();
          localStorage.setItem(key, JSON.stringify(mergedArray));
          log(`📡 Received player sync from another tab: ${updatedPlayers.length} incoming, ${mergedArray.length} after merge`);
          
          // Trigger a custom event so components can react
          window.dispatchEvent(new CustomEvent('players-synced', { detail: mergedArray }));
        }
      }
    });
  } catch (error) {
    // BroadcastChannel not supported, use storage event
    window.addEventListener('storage', (e) => {
      if (e.key === PLAYERS_STORAGE_EVENT_KEY) {
        // Reload players from storage
        const players = getTodayPlayers();
        window.dispatchEvent(new CustomEvent('players-synced', { detail: players }));
      }
    });
  }
}

/**
 * Sync players from another device/view
 * Call this on TV/tablet/public views to get latest players
 */
export async function syncPlayersFromAdmin(clubDayId: string): Promise<Player[]> {
  // Try to load from backend sync first
  const syncedPlayers = await loadPlayersFromBackend(clubDayId);
  
  if (syncedPlayers.length > 0) {
    // Merge with local players (local takes precedence for conflicts)
    const localPlayers = getTodayPlayers();
    const merged = new Map<string, Player>();
    
    // Add synced players first
    syncedPlayers.forEach(p => merged.set(p.id, p));
    
    // Add local players (will overwrite if same ID)
    localPlayers.forEach(p => merged.set(p.id, p));
    
    const mergedArray = Array.from(merged.values());
    saveTodayPlayers(mergedArray, false); // Don't sync back (we're receiving)
    return mergedArray;
  }
  
  return getTodayPlayers();
}

/**
 * Enrich TableSeat or TableWaitlist with player data from localStorage
 * This replaces the backend player relationship lookup
 */
export function enrichWithPlayerData<T extends { player_id: string; player?: Player }>(item: T): T {
  if (item.player) {
    // Already has player data, return as-is
    return item;
  }
  
  // Look up player from localStorage
  const playerData = getPlayerByIdLocal(item.player_id);
  if (playerData) {
    return {
      ...item,
      player: playerData,
    };
  }
  
  // Player not found in localStorage, return with undefined player
  return item;
}

/**
 * Enrich an array of TableSeat or TableWaitlist items with player data
 */
export function enrichArrayWithPlayerData<T extends { player_id: string; player?: Player }>(items: T[]): T[] {
  return items.map(enrichWithPlayerData);
}
