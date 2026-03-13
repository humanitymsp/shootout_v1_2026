/**
 * Centralized Table Count Functions
 * 
 * Single source of truth for counting seated players and waitlist across all views.
 * Ensures consistency between Admin, TV, Tablet, and Public views.
 * 
 * CRITICAL: This module relies on pagination support in the API functions.
 * If pagination breaks in getSeatedPlayersForTable() or getWaitlistForTable(),
 * counts will be inaccurate after ~6-100 players (depending on pagination limit).
 * 
 * See docs/PAGINATION_CRITICAL_FIX.md for full documentation.
 */

import { getSeatedPlayersForTable, getWaitlistForTable } from './api';
import type { TableSeat, TableWaitlist } from '../types';
import { log } from './logger';

export interface TableCounts {
  seatedCount: number;
  waitlistCount: number;
  seatedPlayers: TableSeat[];
  waitlistPlayers: TableWaitlist[];
}

/**
 * Get accurate counts for a table (server-confirmed only, no optimistic updates)
 * This is the SINGLE SOURCE OF TRUTH for all views
 * 
 * CRITICAL: This function relies on getSeatedPlayersForTable() and getWaitlistForTable()
 * which MUST have pagination support and high limits (1000) to fetch all players.
 * Without proper pagination, counts will be inaccurate after ~6-100 players.
 * 
 * @param tableId - The table ID
 * @returns TableCounts with accurate counts and player lists
 * 
 * See docs/PAGINATION_CRITICAL_FIX.md for full documentation.
 */
export async function getTableCounts(tableId: string, clubDayId?: string, authMode?: string): Promise<TableCounts> {
  try {
    // CRITICAL: These API calls MUST use pagination and high limits (1000)
    // If pagination is broken, counts will be inaccurate
    // CRITICAL: Pass clubDayId to prevent showing players from old club days after reset
    // Get seats and waitlist using the same function all views should use
    const [seats, waitlist] = await Promise.all([
      getSeatedPlayersForTable(tableId, clubDayId, authMode),
      getWaitlistForTable(tableId, clubDayId, authMode),
    ]);
    
    // CRITICAL: Filter out temporary optimistic entries (IDs starting with 'temp-')
    // These are client-side only and shouldn't be counted
    const filteredSeats = seats.filter(seat => !seat.id.startsWith('temp-'));
    const filteredWaitlist = waitlist.filter(wl => !wl.id.startsWith('temp-'));
    
    // CRITICAL: Deduplicate by player_id to ensure accurate count
    // A player should only be counted once even if there are duplicate records
    // When duplicates exist, keep the one with the earliest seated_at time (same logic as TableCard)
    const uniqueSeatsMap = new Map<string, TableSeat>();
    for (const seat of filteredSeats) {
      if (!uniqueSeatsMap.has(seat.player_id)) {
        uniqueSeatsMap.set(seat.player_id, seat);
      } else {
        // If duplicate, keep the one with the earlier seated_at time (consistent with TableCard)
        const existing = uniqueSeatsMap.get(seat.player_id)!;
        const existingTime = new Date(existing.seated_at).getTime();
        const currentTime = new Date(seat.seated_at).getTime();
        if (currentTime < existingTime) {
          uniqueSeatsMap.set(seat.player_id, seat);
        }
      }
    }
    
    const uniqueWaitlistMap = new Map<string, TableWaitlist>();
    for (const wl of filteredWaitlist) {
      if (!uniqueWaitlistMap.has(wl.player_id)) {
        uniqueWaitlistMap.set(wl.player_id, wl);
      }
    }
    
    const seatedCount = uniqueSeatsMap.size;
    const waitlistCount = uniqueWaitlistMap.size;
    const seatedPlayers = Array.from(uniqueSeatsMap.values());
    const waitlistPlayers = Array.from(uniqueWaitlistMap.values())
      .sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
    
    // Debug logging to help identify discrepancies
    if (seats.length !== filteredSeats.length) {
      log(`📊 TableCounts: Filtered out ${seats.length - filteredSeats.length} temp seat entries`);
    }
    if (filteredSeats.length !== seatedCount) {
      log(`📊 TableCounts [${tableId}]: Deduplicated ${filteredSeats.length} seats to ${seatedCount} unique players`);
      // Log duplicate player IDs for debugging
      const playerIdCounts = new Map<string, number>();
      filteredSeats.forEach(seat => {
        playerIdCounts.set(seat.player_id, (playerIdCounts.get(seat.player_id) || 0) + 1);
      });
      const duplicates = Array.from(playerIdCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        log(`⚠️ TableCounts [${tableId}]: Found ${duplicates.length} duplicate player(s):`, duplicates.map(([pid, count]) => `Player ${pid} (${count} seats)`));
      }
    }
    
    return {
      seatedCount,
      waitlistCount,
      seatedPlayers,
      waitlistPlayers,
    };
  } catch (error) {
    log(`Error getting table counts for ${tableId}:`, error);
    // Return empty counts on error
    return {
      seatedCount: 0,
      waitlistCount: 0,
      seatedPlayers: [],
      waitlistPlayers: [],
    };
  }
}

/**
 * Get counts for multiple tables efficiently
 * 
 * @param tableIds - Array of table IDs
 * @returns Map of tableId -> TableCounts
 */
export async function getMultipleTableCounts(tableIds: string[]): Promise<Map<string, TableCounts>> {
  const countsMap = new Map<string, TableCounts>();
  
  // Fetch all counts in parallel
  const countPromises = tableIds.map(async (tableId) => {
    const counts = await getTableCounts(tableId);
    return { tableId, counts };
  });
  
  const results = await Promise.all(countPromises);
  results.forEach(({ tableId, counts }) => {
    countsMap.set(tableId, counts);
  });
  
  return countsMap;
}

/**
 * BATCH: Get counts for ALL tables in a club day using just 2 GraphQL queries total.
 * 
 * Instead of calling getTableCounts() per table (2 queries each = 2N queries),
 * this fetches ALL seats and ALL waitlists for the entire club day in 2 queries,
 * then groups by table_id in JavaScript.
 * 
 * Use this in display pages (TV, Public, MobileTV) that show all tables at once.
 * 
 * @param clubDayId - The club day ID
 * @param authMode - Optional auth mode (e.g., 'apiKey' for public pages)
 * @returns Map of tableId -> TableCounts, plus allWaitlists for cross-table lookups
 */
export async function getAllTableCountsForClubDay(
  clubDayId: string,
  authMode?: string
): Promise<{ countsMap: Map<string, TableCounts>; allWaitlists: any[] }> {
  const { generateClient } = await import('./graphql-client');
  const client = generateClient();

  // TWO queries instead of 2N queries
  const seatListOpts: any = {
    filter: {
      and: [
        { clubDayId: { eq: clubDayId } },
        { leftAt: { attributeExists: false } },
      ],
    },
    limit: 1000,
  };
  const wlListOpts: any = {
    filter: {
      and: [
        { clubDayId: { eq: clubDayId } },
        { removedAt: { attributeExists: false } },
      ],
    },
    limit: 1000,
  };
  if (authMode) {
    seatListOpts.authMode = authMode;
    wlListOpts.authMode = authMode;
  }

  const [seatResult, wlResult] = await Promise.all([
    client.models.TableSeat.list(seatListOpts),
    client.models.TableWaitlist.list(wlListOpts),
  ]);

  const allSeatsRaw = seatResult.data || [];
  const allWaitlistsRaw = wlResult.data || [];

  // Convert raw Amplify records to app types
  const toSeat = (r: any): TableSeat => ({
    id: r.id,
    club_day_id: r.clubDayId,
    table_id: r.tableId,
    player_id: r.playerId,
    player: r.player ? { id: r.player.id, name: r.player.name, nick: r.player.nick, phone: r.player.phone } as any : undefined,
    seated_at: r.seatedAt,
    left_at: r.leftAt || undefined,
    created_at: r.createdAt || new Date().toISOString(),
  });

  const toWl = (r: any): TableWaitlist => ({
    id: r.id,
    club_day_id: r.clubDayId,
    table_id: r.tableId,
    player_id: r.playerId,
    player: r.player ? { id: r.player.id, name: r.player.name, nick: r.player.nick, phone: r.player.phone } as any : undefined,
    position: r.position,
    added_at: r.addedAt,
    called_in: r.calledIn || false,
    removed_at: r.removedAt || undefined,
    created_at: r.createdAt || new Date().toISOString(),
  });

  let allSeats = allSeatsRaw.map(toSeat);
  let allWaitlists = allWaitlistsRaw.map(toWl);

  // Enrich with player data from localStorage (async function — must await)
  try {
    const { enrichArrayWithPlayerData } = await import('./localStoragePlayers');
    allSeats = await enrichArrayWithPlayerData(allSeats);
    allWaitlists = await enrichArrayWithPlayerData(allWaitlists);
  } catch { /* fallback: no enrichment */ }

  // Group by table_id
  const seatsByTable = new Map<string, TableSeat[]>();
  const wlByTable = new Map<string, TableWaitlist[]>();

  for (const seat of allSeats) {
    if (!seat.id.startsWith('temp-')) {
      const arr = seatsByTable.get(seat.table_id) || [];
      arr.push(seat);
      seatsByTable.set(seat.table_id, arr);
    }
  }
  for (const wl of allWaitlists) {
    if (!wl.id.startsWith('temp-')) {
      const arr = wlByTable.get(wl.table_id) || [];
      arr.push(wl);
      wlByTable.set(wl.table_id, arr);
    }
  }

  // Build counts map with deduplication (same logic as getTableCounts)
  const countsMap = new Map<string, TableCounts>();

  const allTableIds = new Set([...seatsByTable.keys(), ...wlByTable.keys()]);
  for (const tableId of allTableIds) {
    const seats = seatsByTable.get(tableId) || [];
    const waitlist = (wlByTable.get(tableId) || []).sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());

    // Deduplicate by player_id
    const uniqueSeatsMap = new Map<string, TableSeat>();
    for (const seat of seats) {
      if (!uniqueSeatsMap.has(seat.player_id)) {
        uniqueSeatsMap.set(seat.player_id, seat);
      } else {
        const existing = uniqueSeatsMap.get(seat.player_id)!;
        if (new Date(seat.seated_at).getTime() < new Date(existing.seated_at).getTime()) {
          uniqueSeatsMap.set(seat.player_id, seat);
        }
      }
    }
    const uniqueWlMap = new Map<string, TableWaitlist>();
    for (const wl of waitlist) {
      if (!uniqueWlMap.has(wl.player_id)) {
        uniqueWlMap.set(wl.player_id, wl);
      }
    }

    countsMap.set(tableId, {
      seatedCount: uniqueSeatsMap.size,
      waitlistCount: uniqueWlMap.size,
      seatedPlayers: Array.from(uniqueSeatsMap.values()),
      waitlistPlayers: Array.from(uniqueWlMap.values()),
    });
  }

  return { countsMap, allWaitlists };
}
