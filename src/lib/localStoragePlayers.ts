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
 * Query PlayerSync records for a clubDayId using the GSI (efficient Query)
 * instead of PlayerSync.list + filter which does a full table Scan.
 *
 * Uses the ClubDay.playerSyncs relationship resolver which AppSync maps to
 * a DynamoDB Query on index "gsi-ClubDay.playerSyncs" (~4.5 RCUs vs ~120+ RCUs for Scan).
 */
async function queryPlayerSyncByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const { getClient } = await import('./api');
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDayPlayerSyncs($id: ID!) {
        getClubDay(id: $id) {
          playerSyncs {
            items {
              id
              clubDayId
              playersJson
              syncedAt
            }
          }
        }
      }
    `;
    const options: any = { query, variables: { id: clubDayId } };
    if (authMode) options.authMode = authMode;
    const result: any = await client.graphql(options);
    const items = result?.data?.getClubDay?.playerSyncs?.items;
    return Array.isArray(items) ? items : [];
  } catch (error) {
    logWarn('queryPlayerSyncByClubDay failed, falling back to list:', error);
    return [];
  }
}

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
export function getTodayPlayers(): Player[] {
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
    
    // Check if PlayerSync entry exists for this club day (uses GSI query, not Scan)
    let existingSyncs: any[] = await queryPlayerSyncByClubDay(clubDayId, 'apiKey');
    if (existingSyncs.length === 0) {
      // Fallback to list if GSI query failed (e.g. ClubDay doesn't exist yet)
      const fallback = await client.models.PlayerSync.list({
        filter: { clubDayId: { eq: clubDayId } },
        authMode: 'apiKey',
      }).catch((error: any) => {
        logWarn('PlayerSync.list fallback failed:', error);
        return { data: [] };
      });
      existingSyncs = fallback.data || [];
    }
    
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
export async function loadPlayersFromBackend(clubDayId: string, authMode?: string): Promise<Player[]> {
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

    // Try to fetch from backend PlayerSync model (GSI query, not Scan)
    let syncEntries: any[] = await queryPlayerSyncByClubDay(clubDayId, authMode);
    if (syncEntries.length === 0) {
      // Fallback to list if GSI query returned nothing
      const listOpts: any = {
        filter: { clubDayId: { eq: clubDayId } },
      };
      if (authMode) listOpts.authMode = authMode;
      const fallback = await client.models.PlayerSync.list(listOpts);
      syncEntries = fallback.data || [];
    }
    
    if (syncEntries && syncEntries.length > 0) {
      const latestSync = syncEntries[0]; // Should only be one per club day
      let rawData = latestSync.playersJson as any;
      
      // playersJson may be a string (needs parsing) or already parsed by AppSync
      if (typeof rawData === 'string') {
        try { rawData = JSON.parse(rawData); } catch { rawData = null; }
      }

      // Handle both formats: plain array [...] or {players: [...]}
      let syncedPlayers: Player[] | null = null;
      if (Array.isArray(rawData)) {
        syncedPlayers = rawData;
      } else if (rawData && rawData.players && Array.isArray(rawData.players)) {
        syncedPlayers = rawData.players;
      }

      if (syncedPlayers && syncedPlayers.length > 0) {
        // Update localStorage cache
        const syncKey = `players-sync-${clubDayId}`;
        localStorage.setItem(syncKey, JSON.stringify({ players: syncedPlayers }));
        
        // Merge with local players (local is source of truth - backend sync may be stale)
        const localPlayers = getTodayPlayers();
        
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
export function startPlayerSyncPolling(clubDayId: string, callback: (players: Player[]) => void, intervalMs = 2000, authMode?: string): () => void {
  let intervalId: number | null = null;
  
  const poll = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const players = await loadPlayersFromBackend(clubDayId, authMode);
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
 * Pass clubDayId to also push to PlayerSync (so public page can see names).
 */
export function upsertPlayerLocal(player: Player, clubDayId?: string): void {
  const players = getTodayPlayers();
  const idx = players.findIndex(p => p.id === player.id);
  if (idx >= 0) {
    players[idx] = { ...players[idx], ...player };
  } else {
    players.push(player);
  }
  saveTodayPlayers(players, !!clubDayId, clubDayId);
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
 * Check if a player object has a valid, displayable nickname.
 * Returns false for undefined, null, empty string, 'Unknown', or 'Player-xxxxxx' placeholders.
 */
function hasValidNick(player?: Player): boolean {
  if (!player) return false;
  const nick = player.nick;
  if (!nick || nick === 'Unknown' || nick.startsWith('Player-')) return false;
  // Also reject empty/whitespace-only nicks
  if (nick.trim().length === 0) return false;
  return true;
}

/**
 * Enrich TableSeat or TableWaitlist with player data from localStorage.
 * SYNC-ONLY: checks localStorage cache. Does NOT make API calls.
 * If player is not in cache, creates a placeholder that will be resolved
 * by the async enrichArrayWithPlayerData function.
 */
export function enrichWithPlayerData<T extends { player_id: string; player?: Player }>(item: T): T {
  // If item already has valid player data (e.g. from AppSync relation), keep it
  if (hasValidNick(item.player)) {
    return item;
  }
  
  // Look up player from localStorage (scans all cache keys)
  const playerData = getPlayerByIdLocal(item.player_id);
  if (playerData && hasValidNick(playerData)) {
    return {
      ...item,
      player: playerData,
    };
  }
  
  // Placeholder — will be resolved by enrichArrayWithPlayerData async fallbacks
  const shortId = item.player_id ? item.player_id.slice(-6) : '???';
  return {
    ...item,
    player: {
      id: item.player_id,
      name: `Player-${shortId}`,
      nick: `Player-${shortId}`,
      created_at: '',
      updated_at: '',
    },
  };
}

/**
 * Helper: check if any items have unresolved player names.
 */
function hasUnresolvedPlayers<T extends { player_id: string; player?: Player }>(items: T[]): T[] {
  return items.filter(item =>
    item.player_id && !hasValidNick(item.player)
  );
}

/**
 * Enrich an array of TableSeat or TableWaitlist items with player data.
 *
 * Resolution order (each layer is independent — later layers catch earlier failures):
 *   1. AppSync query relation (player already on item from GraphQL response)
 *   2. localStorage cache (sync, instant)
 *   3. Player.list bulk fetch (async, 1 API call for ALL players)
 *   4. Individual Player.get per missing ID (async, N calls — last resort)
 *
 * After ALL layers, any remaining "Player-xxxxxx" placeholders are logged with
 * their IDs for diagnostics. This function NEVER silently swallows failures.
 */
export async function enrichArrayWithPlayerData<T extends { player_id: string; player?: Player }>(items: T[], authMode?: string): Promise<T[]> {
  if (items.length === 0) return items;

  // ── Layer 1: Items may already have player data from AppSync relation ──
  // (No action needed — data comes from the GraphQL query itself)

  // ── Layer 2: Sync localStorage cache lookup ──
  let enriched = items.map(enrichWithPlayerData);
  let unresolved = hasUnresolvedPlayers(enriched);
  if (unresolved.length === 0) return enriched;

  // ── Layer 3: Bulk Player.list → populate cache, then re-enrich ──
  try {
    await loadAllPlayersToCache(authMode, true); // force=true: bypass cooldown when placeholders exist
    enriched = enriched.map(item => !hasValidNick(item.player) ? enrichWithPlayerData(item) : item);
    unresolved = hasUnresolvedPlayers(enriched);
    if (unresolved.length === 0) return enriched;
  } catch (error) {
    logWarn('⚠️ enrichment Layer 3 (Player.list bulk) failed:', error);
  }

  // ── Layer 4: Individual Player.get for each missing ID ──
  // NOTE: Player.get and Player.list lack @aws_api_key authorization in the AppSync schema.
  // So this layer ONLY works for userPool auth (admin). For apiKey (tablet/TV), skip it.
  if (unresolved.length > 0 && authMode !== 'apiKey') {
    try {
      const { getClient } = await import('./api');
      const client = getClient();
      if (client?.models?.Player) {
        const missingIds = [...new Set(unresolved.map(item => item.player_id))];
        log(`📥 Layer 4: Fetching ${missingIds.length} individual player(s) by ID (userPool)`);
        const fetchedMap = new Map<string, Player>();
        await Promise.allSettled(
          missingIds.map(async (pid) => {
            try {
              const { data } = await client.models.Player.get({ id: pid });
              if (data) {
                const player: Player = {
                  id: data.id,
                  name: (data as any).name || '',
                  nick: (data as any).nick || (data as any).name || '',
                  phone: (data as any).phone || undefined,
                  email: (data as any).email || undefined,
                  created_at: (data as any).createdAt || '',
                  updated_at: (data as any).updatedAt || '',
                };
                fetchedMap.set(player.id, player);
                upsertPlayerLocal(player); // cache for future lookups
              } else {
                logWarn(`⚠️ Player.get returned null for ID ${pid} — player may have been deleted`);
              }
            } catch (err) {
              logWarn(`⚠️ Player.get failed for ID ${pid}:`, err);
            }
          })
        );
        if (fetchedMap.size > 0) {
          enriched = enriched.map(item => {
            if (item.player_id && fetchedMap.has(item.player_id)) {
              return { ...item, player: fetchedMap.get(item.player_id)! };
            }
            return item;
          });
        }
      }
    } catch (error) {
      logWarn('⚠️ enrichment Layer 4 (individual Player.get) failed:', error);
    }
  }

  // ── Final diagnostic: log any STILL unresolved player IDs ──
  const finalUnresolved = hasUnresolvedPlayers(enriched);
  if (finalUnresolved.length > 0) {
    const ids = [...new Set(finalUnresolved.map(i => i.player_id))];
    logError(`🚨 UNRESOLVED PLAYERS after all enrichment layers (${ids.length}): ${ids.join(', ')}`);
    logError('   This means these player IDs do not exist in the Player table or all fetch methods failed.');
  }

  return enriched;
}

// Time-based cache cooldown: allows periodic re-fetches without hammering the API.
// Replaces the old boolean _allPlayersCacheLoaded which blocked ALL retries.
let _lastPlayerCacheLoadTime = 0;
const PLAYER_CACHE_COOLDOWN_MS = 30_000; // 30 seconds

// Module-level active club day ID — set by pages on init so enrichment can
// use it for apiKey PlayerSync lookups without threading through every call.
let _activeClubDayId: string | undefined;

/**
 * Set the active club day ID for player cache operations.
 * Call this from any page after loading the active club day.
 */
export function setActiveClubDayIdForCache(clubDayId: string): void {
  _activeClubDayId = clubDayId;
}

/**
 * Bulk-load ALL players from DynamoDB into localStorage cache.
 * Uses a 30-second cooldown to prevent excessive API calls, but the `force` parameter
 * bypasses the cooldown when enrichment detects unresolved placeholders.
 *
 * CRITICAL: The AppSync schema does NOT grant @aws_api_key access to listPlayers or
 * getPlayer queries. So for apiKey auth (tablet/TV/public), this function loads players
 * from the PlayerSync model instead, which DOES have @aws_api_key authorization.
 * For userPool auth (admin), it uses Player.list directly.
 *
 * @param authMode - 'apiKey' for tablet/TV, omit for admin (uses userPool default)
 * @param force - bypass cooldown (used when enrichment detected placeholders)
 * @param clubDayId - required for apiKey auth to query PlayerSync; optional for userPool
 */
export async function loadAllPlayersToCache(authMode?: string, force = false, clubDayId?: string): Promise<void> {
  const now = Date.now();
  if (!force && _lastPlayerCacheLoadTime > 0 && (now - _lastPlayerCacheLoadTime) < PLAYER_CACHE_COOLDOWN_MS) {
    return; // Within cooldown, skip (unless forced by enrichment)
  }
  
  try {
    // ── apiKey path: use PlayerSync (Player.list lacks @aws_api_key) ──
    if (authMode === 'apiKey') {
      if (!clubDayId) clubDayId = _activeClubDayId;
      if (!clubDayId) {
        // Last resort: try to get clubDayId from the active club day
        try {
          const { getActiveClubDay } = await import('./api');
          const activeDay = await getActiveClubDay('apiKey');
          clubDayId = activeDay?.id;
          if (clubDayId) _activeClubDayId = clubDayId;
        } catch { /* ignore */ }
      }
      if (clubDayId) {
        const players = await loadPlayersFromBackend(clubDayId, 'apiKey');
        if (players.length > 0) {
          _lastPlayerCacheLoadTime = now;
          log(`📥 Bulk-loaded ${players.length} players from PlayerSync (apiKey, clubDay=${clubDayId.slice(-6)})`);
          return;
        }
        logWarn('⚠️ loadAllPlayersToCache: PlayerSync returned 0 players for apiKey auth');
      } else {
        logWarn('⚠️ loadAllPlayersToCache: No clubDayId available for apiKey PlayerSync lookup');
      }
      // Don't update cooldown — let next call retry
      return;
    }
    
    // ── userPool path: use Player.list directly ──
    const { getClient } = await import('./api');
    const client = getClient();
    if (!client?.models?.Player) {
      logWarn('⚠️ loadAllPlayersToCache: Player model not available on client');
      return;
    }
    
    const { data } = await client.models.Player.list({ limit: 10000 });
    if (!data || data.length === 0) {
      logWarn('⚠️ loadAllPlayersToCache: Player.list returned 0 results (userPool) — may be auth race, will retry');
      return; // Don't update cooldown — next call will retry
    }
    
    // Build map of fetched players
    const fetchedMap = new Map<string, Player>();
    for (const raw of data as any[]) {
      const player: Player = {
        id: raw.id,
        name: raw.name || '',
        nick: raw.nick || raw.name || '',
        phone: raw.phone || undefined,
        email: raw.email || undefined,
        created_at: raw.createdAt || raw.created_at || '',
        updated_at: raw.updatedAt || raw.updated_at || '',
      };
      fetchedMap.set(player.id, player);
    }
    
    // CRITICAL: Also load from PlayerSync to recover player-{timestamp}-random IDs.
    // Player.list only returns DynamoDB Player records (UUID IDs, phone-number players).
    // Most players have player-{timestamp}-random IDs stored only in PlayerSync.
    // Without this, a cache reset (e.g., business day flip) loses all those players.
    const effectiveClubDayId = clubDayId || _activeClubDayId;
    if (effectiveClubDayId) {
      try {
        const syncPlayers = await loadPlayersFromBackend(effectiveClubDayId);
        for (const p of syncPlayers) {
          if (p.id && !fetchedMap.has(p.id)) {
            fetchedMap.set(p.id, p);
          }
        }
      } catch { /* non-fatal — PlayerSync unavailable */ }
    }
    
    // Merge into localStorage in ONE batch
    const localPlayers = getTodayPlayers();
    const merged = new Map<string, Player>();
    // DB players first (source of truth)
    fetchedMap.forEach((p, id) => merged.set(id, p));
    // Local players fill gaps (may have edits not yet in DB)
    localPlayers.forEach(p => {
      if (!merged.has(p.id)) merged.set(p.id, p);
    });
    
    const mergedArray = Array.from(merged.values());
    saveTodayPlayers(mergedArray, false); // false = don't sync back to backend
    
    _lastPlayerCacheLoadTime = now;
    log(`📥 Bulk-loaded ${fetchedMap.size} players into localStorage cache (Player.list + PlayerSync, userPool)`);
  } catch (error) {
    logError('🚨 loadAllPlayersToCache FAILED:', error);
    // Do NOT update _lastPlayerCacheLoadTime — next call will retry immediately
  }
}
