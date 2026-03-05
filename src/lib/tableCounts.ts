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
export async function getTableCounts(tableId: string, clubDayId?: string): Promise<TableCounts> {
  try {
    // CRITICAL: These API calls MUST use pagination and high limits (1000)
    // If pagination is broken, counts will be inaccurate
    // CRITICAL: Pass clubDayId to prevent showing players from old club days after reset
    // Get seats and waitlist using the same function all views should use
    const [seats, waitlist] = await Promise.all([
      getSeatedPlayersForTable(tableId, clubDayId),
      getWaitlistForTable(tableId, clubDayId),
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
    const waitlistPlayers = Array.from(uniqueWaitlistMap.values());
    
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
