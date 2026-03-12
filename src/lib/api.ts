// API functions for Amplify Gen 2
// Using GraphQL client to interact with the backend
import { generateClient } from './graphql-client';
import { generateClient as createAmplifyClient } from 'aws-amplify/api';
import { log, logError, logWarn } from './logger';
import type {
  Player,
  ClubDay,
  PokerTable,
  PersistentTable,
  CheckIn,
  Refund,
  Receipt,
  TableSeat,
  TableWaitlist,
  CashCount,
  LedgerEntry,
} from '../types';
import { verifyDataIntegrity } from './dataIntegrity';
import { getPersistentTables, updatePersistentTable } from './persistentTables';

// Lazy client getter - only creates client when first used
let clientInstance: ReturnType<typeof generateClient> | null = null;

export function getClient() {
  if (!clientInstance) {
    clientInstance = generateClient();
  }
  return clientInstance;
}

// Helper to extract error message from various error formats
function extractErrorMessage(error: any): string {
  if (!error) return 'Unknown error';
  
  // If it's already a string, return it
  if (typeof error === 'string') return error;
  
  // Check for common error properties
  if (error.message) return error.message;
  if (error.error) return extractErrorMessage(error.error);
  if (error.errors && Array.isArray(error.errors)) {
    return error.errors.map((e: any) => extractErrorMessage(e)).join('; ');
  }
  if (error.errorMessage) return error.errorMessage;
  if (error.reason) return error.reason;
  
  // Try to stringify if it's an object
  if (typeof error === 'object') {
    try {
      const stringified = JSON.stringify(error, null, 2);
      // If it's a simple object with just a few properties, return formatted
      if (stringified.length < 500) return stringified;
      // Otherwise return a summary
      return `Error: ${Object.keys(error).join(', ')}`;
    } catch {
      return error.toString();
    }
  }
  
  return String(error);
}

// Helper to convert Amplify models to our types
function toPlayer(amplifyPlayer: any): Player {
  return {
    id: amplifyPlayer.id,
    name: amplifyPlayer.name,
    nick: amplifyPlayer.nick,
    phone: amplifyPlayer.phone || undefined,
    email: amplifyPlayer.email || undefined,
    created_at: amplifyPlayer.createdAt,
    updated_at: amplifyPlayer.updatedAt,
  };
}

function toClubDay(amplifyClubDay: any): ClubDay {
  return {
    id: amplifyClubDay.id,
    started_at: amplifyClubDay.startedAt,
    ended_at: amplifyClubDay.endedAt || undefined,
    status: amplifyClubDay.status || 'active',
    created_at: amplifyClubDay.createdAt || new Date().toISOString(),
  };
}

function toPokerTable(amplifyTable: any): PokerTable {
  return {
    id: amplifyTable.id,
    club_day_id: amplifyTable.clubDayId,
    table_number: amplifyTable.tableNumber,
    game_type: amplifyTable.gameType || 'NLH',
    stakes_text: amplifyTable.stakesText,
    seats_total: amplifyTable.seatsTotal,
    bomb_pot_count: amplifyTable.bombPotCount,
    lockout_count: amplifyTable.lockoutCount || 0,
    buy_in_limits: amplifyTable.buyInLimits || undefined,
    show_on_tv: amplifyTable.showOnTv ?? true,
    status: amplifyTable.status || 'OPEN',
    closed_at: amplifyTable.closedAt || undefined,
    created_at: amplifyTable.createdAt || new Date().toISOString(),
  };
}

function toCheckIn(amplifyCheckIn: any): CheckIn {
  return {
    id: amplifyCheckIn.id,
    club_day_id: amplifyCheckIn.clubDayId,
    player_id: amplifyCheckIn.playerId,
    checkin_time: amplifyCheckIn.checkinTime,
    door_fee_amount: amplifyCheckIn.doorFeeAmount,
    payment_method: amplifyCheckIn.paymentMethod,
    receipt_id: amplifyCheckIn.receiptId || undefined,
    override_reason: amplifyCheckIn.overrideReason || undefined,
    refunded_at: amplifyCheckIn.refundedAt || undefined,
    created_at: amplifyCheckIn.createdAt || new Date().toISOString(),
  };
}

function toRefund(amplifyRefund: any): Refund {
  return {
    id: amplifyRefund.id,
    checkin_id: amplifyRefund.checkinId,
    refunded_at: amplifyRefund.refundedAt,
    amount: amplifyRefund.amount,
    reason: amplifyRefund.reason,
    refund_receipt_id: amplifyRefund.refundReceiptId || undefined,
    admin_user: amplifyRefund.adminUser || undefined,
    created_at: amplifyRefund.createdAt || new Date().toISOString(),
  };
}

function toTableSeat(amplifySeat: any): TableSeat {
  return {
    id: amplifySeat.id,
    club_day_id: amplifySeat.clubDayId,
    table_id: amplifySeat.tableId,
    player_id: amplifySeat.playerId,
    player: amplifySeat.player ? toPlayer(amplifySeat.player) : undefined,
    seated_at: amplifySeat.seatedAt,
    left_at: amplifySeat.leftAt || undefined,
    created_at: amplifySeat.createdAt || new Date().toISOString(),
  };
}

function toTableWaitlist(amplifyWaitlist: any): TableWaitlist {
  return {
    id: amplifyWaitlist.id,
    club_day_id: amplifyWaitlist.clubDayId,
    table_id: amplifyWaitlist.tableId,
    player_id: amplifyWaitlist.playerId,
    player: amplifyWaitlist.player ? toPlayer(amplifyWaitlist.player) : undefined,
    position: amplifyWaitlist.position,
    added_at: amplifyWaitlist.addedAt,
    called_in: amplifyWaitlist.calledIn || false,
    removed_at: amplifyWaitlist.removedAt || undefined,
    created_at: amplifyWaitlist.createdAt || new Date().toISOString(),
  };
}

function toLedgerEntry(amplifyEntry: any): LedgerEntry {
  return {
    id: amplifyEntry.id,
    club_day_id: amplifyEntry.clubDayId,
    sequence_number: amplifyEntry.sequenceNumber,
    transaction_type: amplifyEntry.transactionType,
    amount: amplifyEntry.amount,
    balance: amplifyEntry.balance,
    checkin_id: amplifyEntry.checkinId || undefined,
    refund_id: amplifyEntry.refundId || undefined,
    receipt_id: amplifyEntry.receiptId,
    player_id: amplifyEntry.playerId,
    transaction_time: amplifyEntry.transactionTime,
    admin_user: amplifyEntry.adminUser || undefined,
    notes: amplifyEntry.notes || undefined,
    created_at: amplifyEntry.createdAt || new Date().toISOString(),
  };
}

// Player functions
/**
 * Gets all players from the database
 */
export async function getAllPlayers(): Promise<Player[]> {
  log('📋 Fetching all players...');
  
  const amplifyClient = createAmplifyClient();
  const allPlayers: any[] = [];
  let nextToken: string | undefined = undefined;

  try {
    do {
      const response = await amplifyClient.graphql({
        query: `
          query ListAllPlayers($limit: Int, $nextToken: String) {
            listPlayers(limit: $limit, nextToken: $nextToken) {
              items {
                id
                name
                nick
                phone
                email
                createdAt
                updatedAt
              }
              nextToken
            }
          }
        `,
        variables: {
          limit: 1000,
          nextToken: nextToken || null,
        },
      });

      const items = (response as any).data?.listPlayers?.items || [];
      const token = (response as any).data?.listPlayers?.nextToken;
      
      allPlayers.push(...items);
      nextToken = token || undefined;
      
      log('📋 Fetched batch:', items.length, 'players, nextToken:', !!token);
    } while (nextToken);
  } catch (error) {
    logError('📋 Error fetching all players:', error);
    // Fallback to custom client if native client fails
    try {
      const fallbackResponse = await getClient().models.Player.list({});
      if (fallbackResponse.data) {
        allPlayers.push(...fallbackResponse.data);
      }
    } catch (fallbackError) {
      logError('📋 Fallback also failed:', fallbackError);
      throw error;
    }
  }

  log('📋 Total players fetched:', allPlayers.length);
  return allPlayers.map(toPlayer);
}

export async function searchPlayers(query: string): Promise<Player[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  log('🔍 Searching for players with query:', trimmed);

  // Use native Amplify Gen 2 client for proper pagination support
  const amplifyClient = createAmplifyClient();
  
  // Fetch all players with pagination
  const allPlayers: any[] = [];
  let nextToken: string | undefined = undefined;
  
  try {
    do {
      const listQuery = `
        query ListPlayers($limit: Int, $nextToken: String) {
          listPlayers(limit: $limit, nextToken: $nextToken) {
            items {
              id
              name
              nick
              phone
              email
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      `;
      
      const response = await amplifyClient.graphql({
        query: listQuery,
        variables: {
          limit: 1000,
          nextToken: nextToken || null,
        },
      });
      
      const items = (response as any).data?.listPlayers?.items || [];
      const token = (response as any).data?.listPlayers?.nextToken;
      
      allPlayers.push(...items);
      nextToken = token || undefined;
      
      log('🔍 Fetched batch:', items.length, 'players, nextToken:', !!token);
    } while (nextToken);
  } catch (error) {
    logError('🔍 Error fetching players:', error);
    // Fallback to custom client if native client fails
    try {
      const fallbackResponse = await getClient().models.Player.list({});
      if (fallbackResponse.data) {
        allPlayers.push(...fallbackResponse.data);
      }
    } catch (fallbackError) {
      logError('🔍 Fallback also failed:', fallbackError);
      throw error;
    }
  }

  log('🔍 Total players fetched:', allPlayers.length);

  // Client-side filtering for reliable partial matching
  const lowerQuery = trimmed.toLowerCase();
  const filtered = allPlayers.filter((player: any) => {
    const name = (player.name || '').toLowerCase();
    const nick = (player.nick || '').toLowerCase();
    const id = (player.id || '').toLowerCase();
    return name.includes(lowerQuery) || nick.includes(lowerQuery) || id.includes(lowerQuery);
  });

  log('🔍 Filtered results:', filtered.length, 'players');

  // Convert to Player type and deduplicate
  const uniquePlayers = new Map<string, Player>();
  for (const player of filtered) {
    const p = toPlayer(player);
    uniquePlayers.set(p.id, p);
  }
  
  const results = Array.from(uniquePlayers.values());
  log('🔍 Final search results:', results.length, 'players');
  return results;
}

export async function createPlayer(player: { name: string; nick: string; phone?: string; email?: string }): Promise<Player> {
  const { data } = await getClient().models.Player.create(player);
  if (!data) throw new Error('Failed to create player');
  return toPlayer(data);
}

/**
 * Sync a player (with phone/email) to the permanent DynamoDB Player table.
 * Finds existing by phone to avoid duplicates; creates if not found, updates if changed.
 * Non-blocking — callers should fire-and-forget so check-in flow isn't slowed.
 */
export async function syncPlayerToDB(player: { nick: string; phone?: string; email?: string }): Promise<Player | null> {
  const phone = player.phone?.trim();
  if (!phone) return null; // Nothing to persist without a phone number

  try {
    const allPlayers = await getAllPlayers();
    const normalizedPhone = phone.replace(/\D/g, '');
    const existing = allPlayers.find(p => p.phone && p.phone.replace(/\D/g, '') === normalizedPhone);

    if (existing) {
      // Update nick/email if changed
      const updates: Record<string, string> = {};
      if (player.nick && player.nick !== existing.nick) updates.nick = player.nick;
      if (player.nick && player.nick !== existing.name) updates.name = player.nick;
      if (player.email?.trim() && player.email.trim() !== existing.email) updates.email = player.email.trim();

      if (Object.keys(updates).length > 0) {
        const { data } = await getClient().models.Player.update({ id: existing.id, ...updates });
        log(`✅ Updated DynamoDB Player ${existing.id} with:`, updates);
        return data ? toPlayer(data) : existing;
      }
      return existing;
    }

    // Create new permanent Player record
    const created = await createPlayer({ name: player.nick, nick: player.nick, phone, email: player.email?.trim() || undefined });
    log(`✅ Created permanent DynamoDB Player: ${created.nick} (${created.id}) phone=${phone}`);
    return created;
  } catch (error) {
    logError('Failed to sync player to DynamoDB (non-critical):', error);
    return null;
  }
}

/**
 * Find an existing player by phone number, or create a new one.
 * Used by the public signup flow so waitlist entries are real DB records.
 */
export async function findOrCreatePlayerByPhone(nick: string, phone: string): Promise<Player> {
  // Search all players for matching phone
  const allPlayers = await getAllPlayers();
  const normalizedPhone = phone.replace(/\D/g, '');
  const existing = allPlayers.find(p => p.phone && p.phone.replace(/\D/g, '') === normalizedPhone);
  if (existing) return existing;
  // Create new player
  return createPlayer({ name: nick, nick, phone });
}

/**
 * Purges players who haven't checked in within the last N days (default 90).
 * More efficient than pruneInactivePlayers — fetches all check-ins once,
 * builds an active-player set, then deletes in batches.
 * Returns a summary of what was deleted.
 */
export async function purgeOldPlayers(
  adminUser: string,
  daysInactive: number = 90
): Promise<{ scanned: number; deleted: number; skipped: number; errors: string[] }> {
  const client = getClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysInactive);
  const cutoffISO = cutoff.toISOString();

  log(`🗑️ purgeOldPlayers: cutoff=${cutoffISO} (${daysInactive} days)`);

  // Step 1: Fetch all players
  const allPlayers = await getAllPlayers();
  log(`🗑️ purgeOldPlayers: ${allPlayers.length} total players`);

  // Step 2: Fetch ALL check-ins since the cutoff date in one query
  // Players with any check-in after cutoff are considered active
  const recentCheckIns = await client.models.CheckIn.list({
    filter: { checkinTime: { ge: cutoffISO } },
    limit: 10000,
  });
  const activePlayerIds = new Set(
    (recentCheckIns.data || []).map((ci: any) => ci.playerId)
  );
  log(`🗑️ purgeOldPlayers: ${activePlayerIds.size} players active in last ${daysInactive} days`);

  // Step 3: Identify candidates — players with NO check-in since cutoff
  const candidates = allPlayers.filter(p => !activePlayerIds.has(p.id));
  log(`🗑️ purgeOldPlayers: ${candidates.length} candidates for deletion`);

  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Step 4: Delete each candidate
  for (const player of candidates) {
    try {
      // Safety: skip players with local-format IDs (player-{ts}-{rand}) — they live in localStorage
      if (player.id.startsWith('player-')) {
        skipped++;
        continue;
      }
      await client.models.Player.delete({ id: player.id });
      deleted++;
      log(`  ✅ Deleted ${player.nick} (${player.id})`);
    } catch (error: any) {
      const msg = `Failed to delete ${player.nick} (${player.id}): ${error.message}`;
      logError(`  ❌ ${msg}`);
      errors.push(msg);
    }
  }

  log(`✅ purgeOldPlayers complete: ${deleted} deleted, ${skipped} skipped, ${errors.length} errors`);

  // Audit log
  try {
    await client.models.AuditLog.create({
      adminUser,
      action: 'purge_old_players',
      entityType: 'Player',
      reason: `Purged ${deleted} players inactive for ${daysInactive}+ days (cutoff: ${cutoffISO})`,
    });
  } catch (err) {
    logWarn('Failed to write audit log for purge:', err);
  }

  return { scanned: allPlayers.length, deleted, skipped, errors };
}

/**
 * Finds players who haven't checked in for 6+ months
 * Returns array of players who should be pruned
 */
export async function findInactivePlayers(monthsInactive: number = 6): Promise<Player[]> {
  const client = getClient();
  const allPlayers = await getAllPlayers();
  const inactivePlayers: Player[] = [];
  
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsInactive);
  const cutoffDateISO = cutoffDate.toISOString();
  
  log(`🔍 Finding players inactive since ${cutoffDateISO} (${monthsInactive} months ago)`);
  
  for (const player of allPlayers) {
    try {
      // Get all check-ins for this player, ordered by checkinTime descending
      const { data: checkIns } = await client.models.CheckIn.list({
        filter: {
          playerId: { eq: player.id },
        },
      });
      
      if (!checkIns || checkIns.length === 0) {
        // Player has never checked in - consider inactive
        inactivePlayers.push(player);
        log(`  ⚠️ Player ${player.nick} (${player.id}) has never checked in`);
        continue;
      }
      
      // Find the most recent check-in
      const sortedCheckIns = [...checkIns].sort((a, b) => 
        new Date(b.checkinTime).getTime() - new Date(a.checkinTime).getTime()
      );
      const lastCheckIn = sortedCheckIns[0];
      
      if (new Date(lastCheckIn.checkinTime) < cutoffDate) {
        inactivePlayers.push(player);
        log(`  ⚠️ Player ${player.nick} (${player.id}) last checked in: ${lastCheckIn.checkinTime}`);
      }
    } catch (error) {
      logError(`Error checking player ${player.id}:`, error);
      // Continue with other players even if one fails
    }
  }
  
  log(`✅ Found ${inactivePlayers.length} inactive players out of ${allPlayers.length} total`);
  return inactivePlayers;
}

/**
 * Deletes players who haven't checked in for 6+ months
 * Also cleans up related data (seats, waitlists, check-ins, receipts)
 */
export async function pruneInactivePlayers(adminUser: string, monthsInactive: number = 6): Promise<{ deleted: number; errors: string[] }> {
  const inactivePlayers = await findInactivePlayers(monthsInactive);
  const client = getClient();
  let deleted = 0;
  const errors: string[] = [];
  
  log(`🗑️ Starting prune operation for ${inactivePlayers.length} inactive players`);
  
  for (const player of inactivePlayers) {
    try {
      // Get all seats for this player
      const { data: seats } = await client.models.TableSeat.list({
        filter: {
          playerId: { eq: player.id },
        },
      });
      
      // Mark all seats as left
      for (const seat of seats || []) {
        if (!seat.leftAt) {
          await client.models.TableSeat.update({
            id: seat.id,
            leftAt: new Date().toISOString(),
          });
        }
      }
      
      // Get all waitlist entries
      const { data: waitlists } = await client.models.TableWaitlist.list({
        filter: {
          playerId: { eq: player.id },
        },
      });
      
      // Mark all waitlists as removed
      for (const wl of waitlists || []) {
        if (!wl.removedAt) {
          await client.models.TableWaitlist.update({
            id: wl.id,
            removedAt: new Date().toISOString(),
          });
        }
      }
      
      // Delete the player (this should cascade delete related records if configured)
      await client.models.Player.delete({ id: player.id });
      deleted++;
      log(`  ✅ Deleted player ${player.nick} (${player.id})`);
    } catch (error: any) {
      const errorMsg = `Failed to delete player ${player.nick} (${player.id}): ${error.message}`;
      logError(`  ❌ ${errorMsg}`);
      errors.push(errorMsg);
    }
  }
  
  log(`✅ Prune complete: ${deleted} players deleted, ${errors.length} errors`);
  
  // Log the action
  if (adminUser && adminUser !== 'system') {
    try {
      await getClient().models.AuditLog.create({
        adminUser,
        action: 'prune_inactive_players',
        entityType: 'Player',
        reason: `Deleted ${deleted} players inactive for ${monthsInactive}+ months`,
      });
    } catch (error) {
      // Audit log creation is optional, don't fail if it fails
      logWarn('Failed to create audit log:', error);
    }
  }
  
  return { deleted, errors };
}

// ClubDay functions
export async function getActiveClubDay(authMode?: string): Promise<ClubDay | null> {
  const opts: any = {
    filter: {
      status: { eq: 'active' },
    },
  };
  if (authMode) opts.authMode = authMode;
  const { data } = await getClient().models.ClubDay.list(opts);
  if (!data || data.length === 0) return null;
  // Ensure we pick the most recent active club day if multiple exist
  const sorted = [...data].sort((a, b) => {
    const aStarted = new Date(a.startedAt || a.createdAt || 0).getTime();
    const bStarted = new Date(b.startedAt || b.createdAt || 0).getTime();
    return bStarted - aStarted;
  });
  return toClubDay(sorted[0]);
}

/**
 * ============================================================================
 * BUSINESS DAY RESET SYSTEM - Production-Grade Architecture
 * ============================================================================
 * 
 * BUSINESS DAY MODEL:
 * - Start: 9:00 AM local time (Pacific)
 * - End: 3:00 AM local time (next calendar day)
 * - Duration: 18 hours
 * 
 * The business day "belongs to" the calendar date it started on, but runs until 3am the next morning.
 * Example: A day that starts at 9am Monday runs until 3am Tuesday morning.
 * 
 * LEDGER SAFETY (CRITICAL):
 * - Ledger entries are IMMUTABLE and reference club_day_id (business_day_id)
 * - Day reset NEVER deletes or modifies ledger rows
 * - All daily totals derived by querying ledger entries by club_day_id
 * 
 * TIMEZONE & DST SAFETY:
 * - All timestamps stored in UTC in database
 * - Business logic uses Pacific timezone (America/Los_Angeles)
 * - DST transitions handled automatically by timezone library
 * 
 * IDEMPOTENCY:
 * - Reset operations are safe to call multiple times
 * - Uses distributed lock mechanism to prevent concurrent resets
 * - Checks current state before performing actions
 * 
 * ============================================================================
 */

// Business day configuration
const BUSINESS_TIMEZONE = 'America/Los_Angeles';
const BUSINESS_DAY_START_HOUR = 9; // 9:00 AM
const BUSINESS_DAY_END_HOUR = 3;   // 3:00 AM (next calendar day)

/**
 * Gets the current time in the business timezone (Pacific)
 * Handles DST automatically via timezone library
 */
export function getBusinessTimezoneTime(): Date {
  const now = new Date();
  // Convert UTC to Pacific timezone
  const pacificTimeStr = now.toLocaleString('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse back to Date object (in local timezone, but represents Pacific time)
  // Format: MM/DD/YYYY, HH:MM:SS
  const [datePart, timePart] = pacificTimeStr.split(', ');
  const [month, day, year] = datePart.split('/').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  // Create date representing Pacific time (but in local timezone context)
  // This is a workaround - ideally we'd use a proper timezone library
  const pacificDate = new Date(year, month - 1, day, hour, minute, second);
  
  // Calculate offset to get actual Pacific time
  const utcTime = now.getTime();
  const localTime = pacificDate.getTime();
  const offset = utcTime - localTime;
  
  // Return date adjusted for Pacific timezone
  return new Date(utcTime - offset);
}

/**
 * Calculates which business day a given timestamp belongs to
 * 
 * Business day logic:
 * - If time is between 9:00 AM and 11:59:59 PM → belongs to today's business day
 * - If time is between 12:00 AM and 2:59:59 AM → belongs to yesterday's business day
 * - If time is between 3:00 AM and 8:59:59 AM → belongs to yesterday's business day (reset window)
 * 
 * @param timestamp - ISO timestamp string or Date object
 * @returns Object with business day date and boundaries
 */
export function getBusinessDayForTimestamp(timestamp: string | Date | null): {
  businessDayDate: Date;  // The calendar date this business day "belongs to"
  businessDayStart: Date; // 9:00 AM on businessDayDate
  businessDayEnd: Date;   // 3:00 AM on businessDayDate + 1 day
} {
  if (!timestamp) {
    // Use current time
    const pacificNow = getBusinessTimezoneTime();
    return getBusinessDayForTimestamp(pacificNow);
  }
  
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const pacificTime = new Date(date.toLocaleString('en-US', { timeZone: BUSINESS_TIMEZONE }));
  
  const hour = pacificTime.getHours();
  const year = pacificTime.getFullYear();
  const month = pacificTime.getMonth();
  const day = pacificTime.getDate();
  
  let businessDayDate: Date;
  
  if (hour >= BUSINESS_DAY_START_HOUR) {
    // Between 9:00 AM and 11:59:59 PM → belongs to today's business day
    businessDayDate = new Date(year, month, day);
  } else if (hour >= BUSINESS_DAY_END_HOUR) {
    // Between 3:00 AM and 8:59:59 AM → belongs to yesterday's business day
    const yesterday = new Date(year, month, day);
    yesterday.setDate(yesterday.getDate() - 1);
    businessDayDate = yesterday;
  } else {
    // Between 12:00 AM and 2:59:59 AM → belongs to yesterday's business day
    const yesterday = new Date(year, month, day);
    yesterday.setDate(yesterday.getDate() - 1);
    businessDayDate = yesterday;
  }
  
  // Calculate business day boundaries
  const businessDayStart = new Date(businessDayDate);
  businessDayStart.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  
  const businessDayEnd = new Date(businessDayDate);
  businessDayEnd.setDate(businessDayEnd.getDate() + 1);
  businessDayEnd.setHours(BUSINESS_DAY_END_HOUR, 0, 0, 0);
  
  return {
    businessDayDate,
    businessDayStart,
    businessDayEnd
  };
}

/**
 * Determines if a business day should be reset based on current time vs day start time
 * 
 * @param dayStartedAt - ISO timestamp when the club day started
 * @returns Object indicating if reset is needed and why
 */
export function shouldResetBusinessDay(dayStartedAt: string | Date | null): {
  shouldReset: boolean;
  reason: string;
  forceReset: boolean; // true = it's past 3am, must reset regardless of players
} {
  if (!dayStartedAt) {
    return {
      shouldReset: true,
      reason: 'No active business day found',
      forceReset: false
    };
  }
  
  const pacificNow = getBusinessTimezoneTime();
  const dayStart = typeof dayStartedAt === 'string' ? new Date(dayStartedAt) : dayStartedAt;
  
  // Get business day info for the day that started
  const dayInfo = getBusinessDayForTimestamp(dayStart);
  
  // Get business day info for current time
  const currentDayInfo = getBusinessDayForTimestamp(pacificNow);
  
  // Check if we're in a different business day
  const dayStartDateStr = dayInfo.businessDayDate.toISOString().split('T')[0];
  const currentDateStr = currentDayInfo.businessDayDate.toISOString().split('T')[0];
  
  if (dayStartDateStr !== currentDateStr) {
    // Different business day - reset needed
    const hour = pacificNow.getHours();
    const forceReset = hour >= BUSINESS_DAY_END_HOUR && hour < BUSINESS_DAY_START_HOUR;
    
    return {
      shouldReset: true,
      reason: forceReset 
        ? `Business day ended at 3:00 AM - new day started at 9:00 AM on ${currentDateStr}`
        : `New business day started (${currentDateStr} vs ${dayStartDateStr})`,
      forceReset
    };
  }
  
  // Same business day - check if we're past the end time
  if (pacificNow >= dayInfo.businessDayEnd) {
    return {
      shouldReset: true,
      reason: 'Past business day end time (3:00 AM)',
      forceReset: true
    };
  }
  
  return {
    shouldReset: false,
    reason: 'Within current business day',
    forceReset: false
  };
}

/**
 * Distributed lock mechanism for reset operations
 * Uses localStorage as a simple distributed lock (works across tabs)
 * For production, consider using Redis or database-level locks
 */
let resetLockTimeout: ReturnType<typeof setTimeout> | null = null;
const RESET_LOCK_KEY = 'business-day-reset-lock';
const RESET_LOCK_TTL = 60000; // 60 seconds - reset should complete faster than this

function acquireResetLock(): boolean {
  try {
    const lockData = localStorage.getItem(RESET_LOCK_KEY);
    if (lockData) {
      const lock = JSON.parse(lockData);
      const lockTime = new Date(lock.timestamp).getTime();
      const now = Date.now();
      
      // If lock is older than TTL, consider it stale and take it
      if (now - lockTime > RESET_LOCK_TTL) {
        logWarn('Reset lock expired, acquiring stale lock');
        localStorage.setItem(RESET_LOCK_KEY, JSON.stringify({
          timestamp: new Date().toISOString(),
          processId: Math.random().toString(36)
        }));
        return true;
      }
      
      // Lock is held by another process
      return false;
    }
    
    // No lock exists - acquire it
    localStorage.setItem(RESET_LOCK_KEY, JSON.stringify({
      timestamp: new Date().toISOString(),
      processId: Math.random().toString(36)
    }));
    
    // Auto-release lock after TTL
    if (resetLockTimeout) {
      clearTimeout(resetLockTimeout);
    }
    resetLockTimeout = setTimeout(() => {
      releaseResetLock();
    }, RESET_LOCK_TTL);
    
    return true;
  } catch (error) {
    logError('Error acquiring reset lock:', error);
    return false;
  }
}

function releaseResetLock(): void {
  try {
    localStorage.removeItem(RESET_LOCK_KEY);
    if (resetLockTimeout) {
      clearTimeout(resetLockTimeout);
      resetLockTimeout = null;
    }
  } catch (error) {
    logError('Error releasing reset lock:', error);
  }
}


/**
 * Gets the current time in Pacific timezone (legacy compatibility)
 */
export function getPacificTime(): Date {
  return getBusinessTimezoneTime();
}

/**
 * Gets 3am Pacific time for today (or tomorrow if it's already past 3am)
 * Legacy function for compatibility
 */
export function getNext3amPacific(): Date {
  const localTime = getBusinessTimezoneTime();
  const hour = localTime.getHours();
  const next3am = new Date(localTime);
  next3am.setHours(3, 0, 0, 0);
  
  // If it's already past 3am Pacific, return tomorrow's 3am
  if (hour >= 3) {
    next3am.setDate(next3am.getDate() + 1);
  }
  
  return next3am;
}

/**
 * Checks if we're currently in the reset window (between 3am and 9am)
 * Legacy function for compatibility
 */
export function isInResetWindow(): boolean {
  const localTime = getBusinessTimezoneTime();
  const hour = localTime.getHours();
  return hour >= 3 && hour < 9;
}

/**
 * Checks if it's past end of day (3am Pacific) for the given club day
 * Legacy function - now uses business day logic
 */
export function isPastEndOfDay(clubDay: ClubDay | null): boolean {
  if (!clubDay) return false;
  
  const resetCheck = shouldResetBusinessDay(clubDay.started_at);
  return resetCheck.shouldReset && resetCheck.forceReset;
}

/**
 * Checks if the club day should be auto-reset
 * 
 * Uses business day logic: resets when transitioning from one business day to another.
 * Business day boundaries: 9:00 AM - 3:00 AM (next calendar day)
 * 
 * Returns: { shouldReset: boolean, reason: string, forceReset: boolean }
 * - forceReset: true means reset even with players present (it's 3am, day is over)
 */
export function shouldAutoReset(clubDay: ClubDay | null): { shouldReset: boolean; reason: string; forceReset: boolean } {
  return shouldResetBusinessDay(clubDay?.started_at || null);
}

/**
 * Gets the count of active players (seated + waitlist)
 */
export async function getActivePlayerCount(clubDayId: string): Promise<{ seated: number; waitlist: number }> {
  try {
    const [seats, waitlist] = await Promise.all([
      getClient().models.TableSeat.list({
        filter: {
          and: [
            { clubDayId: { eq: clubDayId } },
            { leftAt: { attributeExists: false } },
          ],
        },
      }),
      getClient().models.TableWaitlist.list({
        filter: {
          and: [
            { clubDayId: { eq: clubDayId } },
            { removedAt: { attributeExists: false } },
          ],
        },
      }),
    ]);
    
    return {
      seated: seats.data?.length || 0,
      waitlist: waitlist.data?.length || 0,
    };
  } catch (error) {
    logError('Error getting active player count:', error);
    return { seated: 0, waitlist: 0 };
  }
}

/**
 * Checks if the current club day is stale (older than 24 hours).
 * Used to show a warning banner nudging the admin to run EOD.
 * Does NOT auto-reset — resets are now manual via the EOD report.
 */
export async function checkClubDayStale(): Promise<{ stale: boolean; reason: string; hoursOld: number }> {
  try {
    const activeDay = await getActiveClubDay();
    
    if (!activeDay) {
      return { stale: false, reason: 'No active club day', hoursOld: 0 };
    }
    
    const dayCreatedAt = new Date(activeDay.started_at).getTime();
    const now = Date.now();
    const hoursOld = Math.floor((now - dayCreatedAt) / (1000 * 60 * 60));
    
    if (hoursOld >= 24) {
      return { 
        stale: true, 
        reason: `Club day is ${hoursOld} hours old. Please run End-of-Day report to close this day.`,
        hoursOld 
      };
    }
    
    return { stale: false, reason: 'Within current business day', hoursOld };
  } catch (error) {
    logError('Error checking club day staleness:', error);
    return { stale: false, reason: `Error: ${error}`, hoursOld: 0 };
  }
}

/**
 * @deprecated Auto-reset has been replaced by manual EOD reset.
 * Kept for backward compatibility — now just checks staleness without resetting.
 */
export async function checkAndAutoReset(): Promise<{ reset: boolean; reason: string; playersCleared?: number }> {
  // No longer auto-resets. Resets are manual via EOD report.
  return { reset: false, reason: 'Auto-reset disabled — use EOD report to reset day' };
}

/**
 * Legacy wrapper for backward compatibility - returns just boolean
 */
/**
 * Legacy wrapper for backward compatibility - returns just boolean
 */
export async function checkAndAutoResetLegacy(): Promise<boolean> {
  const result = await checkAndAutoReset();
  return result.reset;
}

/**
 * Get operating schedule information for display
 */
export function getOperatingScheduleInfo(clubDay: ClubDay | null): {
  isOperating: boolean;
  dayStartTime: Date | null;
  dayEndTime: Date | null;
  nextResetTime: Date;
  currentStatus: string;
  hoursUntilReset: number;
} {
  const pacificNow = getPacificTime();
  const hour = pacificNow.getHours();
  
  // Calculate next 3am Pacific reset time
  const next3am = new Date(pacificNow);
  if (hour >= 3) {
    // Past 3am today, next reset is tomorrow at 3am
    next3am.setDate(next3am.getDate() + 1);
  }
  next3am.setHours(3, 0, 0, 0);
  
  // Calculate hours until reset
  const hoursUntilReset = Math.max(0, (next3am.getTime() - pacificNow.getTime()) / (1000 * 60 * 60));
  
  if (!clubDay) {
    return {
      isOperating: false,
      dayStartTime: null,
      dayEndTime: null,
      nextResetTime: next3am,
      currentStatus: 'No active day',
      hoursUntilReset,
    };
  }
  
  const dayStart = new Date(clubDay.started_at);
  
  // Calculate end time (3am Pacific after start)
  const dayStartPacific = new Date(dayStart.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const dayEnd = new Date(dayStartPacific);
  const startHour = dayStartPacific.getHours();
  if (startHour < 3) {
    dayEnd.setHours(3, 0, 0, 0);
  } else {
    dayEnd.setDate(dayEnd.getDate() + 1);
    dayEnd.setHours(3, 0, 0, 0);
  }
  
  // Check if we're in operating hours (between start and 3am Pacific next day)
  const isOperating = pacificNow >= dayStartPacific && pacificNow < dayEnd;
  
  let currentStatus: string;
  if (isOperating) {
    if (hour >= 0 && hour < 3) {
      currentStatus = 'Late night - auto-reset at 3am Pacific';
    } else if (hour >= 9 && hour < 12) {
      currentStatus = 'Morning session';
    } else if (hour >= 12 && hour < 17) {
      currentStatus = 'Afternoon session';
    } else if (hour >= 17 && hour < 21) {
      currentStatus = 'Evening session';
    } else {
      currentStatus = 'Night session';
    }
  } else if (hour >= 3 && hour < 9) {
    currentStatus = 'Between sessions';
  } else {
    currentStatus = 'Day ended - reset pending';
  }
  
  return {
    isOperating,
    dayStartTime: dayStart,
    dayEndTime: dayEnd,
    nextResetTime: next3am,
    currentStatus,
    hoursUntilReset,
  };
}

export async function createClubDay(preservedBuyInLimits?: Map<number, string>): Promise<ClubDay> {
  // Check if active club day already exists (idempotency)
  const existingActiveDay = await getActiveClubDay();
  if (existingActiveDay) {
    log(`ℹ️ Active club day already exists: ${existingActiveDay.id}`);
    return existingActiveDay;
  }
  
  // Ensure new club day starts at 9am Pacific (business day start)
  const localTime = getBusinessTimezoneTime();
  const hour = localTime.getHours();
  const currentDate = localTime.toISOString().split('T')[0]; // YYYY-MM-DD
  const [year, month, day] = currentDate.split('-');
  
  let startTime: Date;
  
  if (hour >= 9) {
    // Already past 9am today - use today's 9am (for manual resets during the day)
    // This handles cases where admin manually resets during business hours
    const today9am = new Date(`${year}-${month}-${day}T09:00:00`);
    // Convert to Pacific timezone
    const pacific9amStr = today9am.toLocaleString('en-US', { 
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    startTime = new Date(pacific9amStr);
  } else {
    // Before 9am - use today's 9am (next business day start)
    const today9am = new Date(`${year}-${month}-${day}T09:00:00`);
    const pacific9amStr = today9am.toLocaleString('en-US', { 
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    startTime = new Date(pacific9amStr);
  }
  
  // Convert Pacific time to UTC for storage
  // Create date in Pacific timezone, then convert to UTC
  const pacificTimeStr = startTime.toLocaleString('en-US', { 
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse and create UTC date
  // Format: MM/DD/YYYY, HH:MM:SS
  // Note: Parsed values are not currently used - using current time instead
  pacificTimeStr.split(', ');
  
  // Create ISO string in UTC (simplified - store as current time for now, will be refined)
  // For now, use current time but log the intended start time
  const now = new Date().toISOString();
  
  const { data } = await getClient().models.ClubDay.create({
    startedAt: now,
    status: 'active',
  });
  if (!data) throw new Error('Failed to create club day');
  
  log(`✅ Created new club day ${data.id} (intended start: 9am Pacific on ${currentDate})`);
  
  // Create default tables (3 tables as specified: 8, 10, 14)
  // Use preserved buy-in limits if available, otherwise use defaults
  const defaultTables = [
    { tableNumber: 8, gameType: 'NLH', stakesText: '$1/$2 No Limit', seatsTotal: 9, buyInLimits: '$40-$400' },
    { tableNumber: 10, gameType: 'NLH', stakesText: '$1/$2 No Limit', seatsTotal: 9, buyInLimits: '$40-$400' },
    { tableNumber: 14, gameType: 'NLH', stakesText: '$1/$2 No Limit', seatsTotal: 9, buyInLimits: '$40-$400' },
  ];
  
  for (const table of defaultTables) {
    // Use preserved buy-in limits if available, otherwise use default
    const preservedBuyIn = preservedBuyInLimits?.get(table.tableNumber);
    const buyInLimits = preservedBuyIn || table.buyInLimits;
    
    // Always explicitly include buyInLimits to ensure it's stored on the backend
    await getClient().models.PokerTable.create({
      clubDayId: data.id,
      tableNumber: table.tableNumber,
      gameType: table.gameType,
      stakesText: table.stakesText,
      seatsTotal: table.seatsTotal,
      bombPotCount: 1,
      buyInLimits: buyInLimits || null, // Explicitly set to null if not provided
      showOnTv: true,
      status: 'OPEN',
    });
  }
  
  return toClubDay(data);
}

// Table functions
export async function getTablesForClubDay(clubDayId: string, authMode?: string): Promise<PokerTable[]> {
  const opts: any = {
    filter: {
      clubDayId: { eq: clubDayId },
    },
  };
  if (authMode) opts.authMode = authMode;
  const { data } = await getClient().models.PokerTable.list(opts);
  return (data || []).map(toPokerTable);
}

export async function createTable(table: {
  clubDayId: string;
  tableNumber: number;
  gameType: string;
  stakesText: string;
  seatsTotal: number;
  bombPotCount: number;
  lockoutCount?: number;
  buyInLimits?: string;
}): Promise<PokerTable> {
  // Always explicitly include buyInLimits to ensure it's stored on the backend
  const { data } = await getClient().models.PokerTable.create({
    clubDayId: table.clubDayId,
    tableNumber: table.tableNumber,
    gameType: table.gameType,
    stakesText: table.stakesText,
    seatsTotal: table.seatsTotal,
    bombPotCount: table.bombPotCount,
    lockoutCount: table.lockoutCount || 0,
    buyInLimits: table.buyInLimits || null,
    status: 'OPEN',
    showOnTv: true,
  });
  if (!data) throw new Error('Failed to create table');
  return toPokerTable(data);
}

const mapTableUpdates = (updates: Partial<PokerTable>) => {
  const mapped: Record<string, any> = {};

  if ('club_day_id' in updates) mapped.clubDayId = updates.club_day_id;
  if ('table_number' in updates) mapped.tableNumber = updates.table_number;
  if ('game_type' in updates) mapped.gameType = updates.game_type;
  if ('stakes_text' in updates) mapped.stakesText = updates.stakes_text;
  if ('seats_total' in updates) mapped.seatsTotal = updates.seats_total;
  if ('bomb_pot_count' in updates) mapped.bombPotCount = updates.bomb_pot_count;
  if ('lockout_count' in updates) mapped.lockoutCount = updates.lockout_count;
  if ('buy_in_limits' in updates) mapped.buyInLimits = updates.buy_in_limits;
  if ('show_on_tv' in updates) mapped.showOnTv = updates.show_on_tv;
  if ('status' in updates) mapped.status = updates.status;
  if ('closed_at' in updates) mapped.closedAt = updates.closed_at;

  return mapped;
};

export async function updateTable(tableId: string, updates: Partial<PokerTable>): Promise<void> {
  await getClient().models.PokerTable.update({
    id: tableId,
    ...mapTableUpdates(updates),
  });
}

export async function deleteTable(tableId: string): Promise<void> {
  // Remove all active seats using the resilient seat removal flow
  const seats = await getSeatedPlayersForTable(tableId);
  for (const seat of seats) {
    await removePlayerFromSeat(seat.id, tableId, 'system');
  }

  // Remove all active waitlist entries using direct mutation
  const waitlist = await getWaitlistForTable(tableId);
  for (const wl of waitlist) {
    await removePlayerFromWaitlist(wl.id, 'system');
  }

  // Delete the table
  await getClient().models.PokerTable.delete({ id: tableId });
}

// Table Seat functions
/**
 * Get all seated players for a specific player (across all tables).
 * 
 * CRITICAL: This function MUST use a high limit (1000) to ensure all seats are fetched.
 * Without this limit, pagination may not fetch all results, causing duplicate-seating checks to fail.
 * 
 * DO NOT remove or reduce the limit parameter.
 * 
 * See docs/PAGINATION_CRITICAL_FIX.md for full documentation.
 */
export async function getSeatedPlayersForPlayer(playerId: string, clubDayId: string): Promise<TableSeat[]> {
  // CRITICAL: Fetch ALL seats for player with explicit limit
  // DO NOT remove or reduce this limit - it will cause duplicate-seating checks to fail
  const PAGINATION_LIMIT = 1000; // CRITICAL: Must be >= 100 to avoid pagination issues
  if (PAGINATION_LIMIT < 100) {
    logError('CRITICAL: PAGINATION_LIMIT is too low! This will break player counting. See docs/PAGINATION_CRITICAL_FIX.md');
    throw new Error('PAGINATION_LIMIT must be >= 100');
  }
  const { data } = await getClient().models.TableSeat.list({
    filter: {
      and: [
        { playerId: { eq: playerId } },
        { clubDayId: { eq: clubDayId } },
        { leftAt: { attributeExists: false } },
      ],
    },
    limit: PAGINATION_LIMIT, // CRITICAL: Explicitly set high limit to get all seats - DO NOT REMOVE
  });

  // Convert to TableSeat format
  const seats = data?.map(toTableSeat) || [];
  
  // Enrich with player data from localStorage
  try {
    const { enrichArrayWithPlayerData } = await import('./localStoragePlayers');
    return enrichArrayWithPlayerData(seats);
  } catch (error) {
    // Fallback to backend lookup
    for (const seat of seats) {
      if (!seat.player && seat.player_id) {
        try {
          const { data: playerData } = await getClient().models.Player.get({ id: seat.player_id });
          if (playerData) {
            seat.player = toPlayer(playerData);
          }
        } catch (err) {
          // Player not found
        }
      }
    }
    return seats;
  }
}

/**
 * Get all seated players for a table.
 * 
 * CRITICAL: This function MUST use a high limit (1000) to ensure all players are fetched.
 * Without this limit, pagination may not fetch all results, causing incorrect counts.
 * 
 * DO NOT remove or reduce the limit parameter - it will break player counting after ~6-100 players.
 * 
 * See docs/PAGINATION_CRITICAL_FIX.md for full documentation.
 */
export async function getSeatedPlayersForTable(tableId: string, clubDayId?: string, authMode?: string): Promise<TableSeat[]> {
  // CRITICAL: Fetch ALL seated players with explicit limit to ensure we get all results
  // Use a high limit (1000) to ensure we get all players even if there are many
  // DO NOT remove or reduce this limit - it will cause incorrect player counts
  const PAGINATION_LIMIT = 1000; // CRITICAL: Must be >= 100 to avoid pagination issues
  if (PAGINATION_LIMIT < 100) {
    logError('CRITICAL: PAGINATION_LIMIT is too low! This will break player counting. See docs/PAGINATION_CRITICAL_FIX.md');
    throw new Error('PAGINATION_LIMIT must be >= 100');
  }
  
  // CRITICAL: Build filter - always exclude left seats, optionally filter by clubDayId
  const filterConditions: any[] = [
    { tableId: { eq: tableId } },
    { leftAt: { attributeExists: false } },
  ];
  
  // CRITICAL: If clubDayId is provided, filter by it to prevent showing players from old club days
  // This ensures that after a day reset, old seats don't appear as "Unknown" players
  if (clubDayId) {
    filterConditions.push({ clubDayId: { eq: clubDayId } });
  }
  
  const listOpts: any = {
    filter: {
      and: filterConditions,
    },
    limit: PAGINATION_LIMIT, // CRITICAL: Explicitly set high limit to get all players - DO NOT REMOVE
  };
  if (authMode) listOpts.authMode = authMode;
  const { data } = await getClient().models.TableSeat.list(listOpts);
  
  // Convert to TableSeat format
  const seats = (data || []).map(toTableSeat);
  
  // Enrich with player data from localStorage (faster than backend lookup)
  try {
    const { enrichArrayWithPlayerData } = await import('./localStoragePlayers');
    return enrichArrayWithPlayerData(seats);
  } catch (error) {
    // Fallback to backend lookup if localStorage enrichment fails
    for (const seat of seats) {
      if (!seat.player && seat.player_id) {
        try {
          const { data: playerData } = await getClient().models.Player.get({ id: seat.player_id });
          if (playerData) {
            seat.player = toPlayer(playerData);
          }
        } catch (err) {
          // Player not found in backend, that's okay - will show as "Unknown"
        }
      }
    }
    return seats;
  }
}

/**
 * Get all busted/removed players for a club day (seats with leftAt set).
 * Returns seats sorted by most recently busted first.
 */
export async function getBustedPlayersForClubDay(clubDayId: string): Promise<TableSeat[]> {
  const { data } = await getClient().models.TableSeat.list({
    filter: {
      and: [
        { clubDayId: { eq: clubDayId } },
        { leftAt: { attributeExists: true } },
      ],
    },
    limit: 1000,
  });

  const seats = (data || []).map(toTableSeat);

  // Enrich with player data from localStorage
  try {
    const { enrichArrayWithPlayerData } = await import('./localStoragePlayers');
    const enriched = await enrichArrayWithPlayerData(seats);
    // Sort by left_at descending (most recent first)
    enriched.sort((a, b) => {
      const timeA = a.left_at ? new Date(a.left_at).getTime() : 0;
      const timeB = b.left_at ? new Date(b.left_at).getTime() : 0;
      return timeB - timeA;
    });
    return enriched;
  } catch {
    return seats;
  }
}

export async function seatPlayer(tableId: string, playerId: string, clubDayId: string): Promise<TableSeat> {
  // Check if player is already seated at THIS table - prevent duplicate at same table
  const currentSeated = await getSeatedPlayersForTable(tableId, clubDayId);
  const existingSeatAtThisTable = currentSeated.find(seat => seat.player_id === playerId);
  if (existingSeatAtThisTable) {
    log(`Player ${playerId} is already seated at table ${tableId}, returning existing seat`);
    return existingSeatAtThisTable; // Return existing seat instead of creating duplicate
  }

  // Check if player is already waitlisted at this table - if so, remove from waitlist first
  // CRITICAL: Pass clubDayId to prevent finding waitlist entries from old club days
  const waitlist = await getWaitlistForTable(tableId, clubDayId);
  const existingWaitlistEntry = waitlist.find(w => w.player_id === playerId);

  if (existingWaitlistEntry) {
    log(`Player ${playerId} is waitlisted at table ${tableId}, removing from waitlist before seating`);
    await removePlayerFromWaitlist(existingWaitlistEntry.id, 'system');
  }

  // Use direct GraphQL mutation to avoid relationship resolution issues
  const mutation = `
    mutation CreateTableSeat($input: CreateTableSeatInput!) {
      createTableSeat(input: $input) {
        id
        tableId
        playerId
        clubDayId
        seatedAt
      }
    }
  `;

  const result = await getClient().graphql({
    query: mutation,
    variables: {
      input: {
        tableId,
        playerId,
        clubDayId,
        seatedAt: new Date().toISOString(),
      }
    }
  });

  if (!result.data?.createTableSeat) throw new Error('Failed to seat player');
  const seat = toTableSeat(result.data.createTableSeat);
  try {
    const { enrichWithPlayerData } = await import('./localStoragePlayers');
    return enrichWithPlayerData(seat);
  } catch {
    return seat;
  }
}

/**
 * Seat a called-in player and charge door fee
 * This is used when a player who was called in (waitlisted without door fee) arrives and wants to play
 */
export async function seatCalledInPlayer(
  tableId: string,
  playerId: string,
  clubDayId: string,
  doorFeeAmount: number,
  adminUser: string
): Promise<{ seat: TableSeat; checkIn: CheckIn; receipt: Receipt }> {
  // First, create check-in with door fee
  const checkInResult = await createCheckIn(
    clubDayId,
    playerId,
    doorFeeAmount,
    'cash',
    `Called-in player arriving`,
    adminUser
  );

  // Then seat the player
  const seat = await seatPlayer(tableId, playerId, clubDayId);

  return {
    seat,
    checkIn: checkInResult.checkIn,
    receipt: checkInResult.receipt,
  };
}

/**
 * Collect buy-in (door fee) for a waitlisted player without seating them.
 * Used when a player is on the waitlist and needs to pay before being seated.
 */
export async function collectBuyIn(
  playerId: string,
  clubDayId: string,
  doorFeeAmount: number,
  adminUser: string
): Promise<{ checkIn: CheckIn; receipt: Receipt }> {
  const result = await createCheckIn(
    clubDayId,
    playerId,
    doorFeeAmount,
    'cash',
    'Buy-in collected for waitlisted player',
    adminUser
  );
  return { checkIn: result.checkIn, receipt: result.receipt };
}

// Data integrity functions
export interface DoubleSeatingIssue {
  playerId: string;
  playerNick?: string;
  playerName?: string;
  seats: Array<{
    seatId: string;
    tableId: string;
    tableNumber?: number;
    seatedAt: string;
  }>;
}

/**
 * Auto-fix function that runs silently to correct data integrity issues:
 * - Removes duplicate seated players (same player at same or different tables)
 * - Enforces table capacity limits (9 seated, 9 waitlist)
 * - Runs without user interaction or notice
 */
export async function autoFixTableIntegrity(clubDayId: string): Promise<{ fixed: number; errors: string[] }> {
  const errors: string[] = [];
  let fixedCount = 0;
  
  try {
    // Get all tables for this club day
    const tables = await getTablesForClubDay(clubDayId);
    
    // Track players we've seen seated
    const playerSeatMap = new Map<string, { seatId: string; tableId: string; seatedAt: string }>();
    const seatsToRemove: string[] = [];
    
    // Step 1: Find and fix duplicate seated players
    // CRITICAL: Pass clubDayId to ensure we only check seats from the current club day
    for (const table of tables) {
      const seated = await getSeatedPlayersForTable(table.id, clubDayId);
      
      // Track unique players per table
      const tablePlayerMap = new Map<string, TableSeat>();
      
      for (const seat of seated) {
        const playerId = seat.player_id;
        
        // Check for duplicate at same table
        if (tablePlayerMap.has(playerId)) {
          // Keep the earliest seat, remove duplicates
          const existingSeat = tablePlayerMap.get(playerId)!;
          const existingTime = new Date(existingSeat.seated_at).getTime();
          const currentTime = new Date(seat.seated_at).getTime();
          
          if (currentTime < existingTime) {
            // Current seat is earlier, remove the existing one
            seatsToRemove.push(existingSeat.id);
            tablePlayerMap.set(playerId, seat);
          } else {
            // Existing seat is earlier, remove current
            seatsToRemove.push(seat.id);
          }
          fixedCount++;
          log(`🔧 Auto-fix: Removing duplicate seat for player ${playerId} at table ${table.id}`);
        } else {
          tablePlayerMap.set(playerId, seat);
        }
        
        // Check for duplicate across different tables
        if (playerSeatMap.has(playerId)) {
          const existingSeat = playerSeatMap.get(playerId)!;
          const existingTime = new Date(existingSeat.seatedAt).getTime();
          const currentTime = new Date(seat.seated_at).getTime();
          
          // Keep the earliest seat, mark later one for removal
          if (currentTime < existingTime) {
            seatsToRemove.push(existingSeat.seatId);
            playerSeatMap.set(playerId, { seatId: seat.id, tableId: table.id, seatedAt: seat.seated_at });
          } else {
            seatsToRemove.push(seat.id);
          }
          fixedCount++;
          log(`🔧 Auto-fix: Removing duplicate seat for player ${playerId} (already seated at another table)`);
        } else {
          playerSeatMap.set(playerId, { seatId: seat.id, tableId: table.id, seatedAt: seat.seated_at });
        }
      }
    }
    
    // Step 2: (capacity enforcement removed — no seat or waitlist limit)
    
    // Step 3: Remove duplicate seats
    // Need to get tableId for each seat before removing
    for (const seatId of seatsToRemove) {
      try {
        const { data: seatData } = await getClient().models.TableSeat.get({ id: seatId });
        if (seatData?.tableId) {
          await removePlayerFromSeat(seatId, seatData.tableId, 'system');
        } else {
          // Fallback: use direct GraphQL mutation if we can't get tableId
          await getClient().graphql({
            query: `
              mutation UpdateTableSeat($input: UpdateTableSeatInput!) {
                updateTableSeat(input: $input) {
                  id
                  leftAt
                }
              }
            `,
            variables: {
              input: {
                id: seatId,
                leftAt: new Date().toISOString(),
              }
            }
          });
        }
      } catch (err: any) {
        // If seat doesn't exist or already removed, that's fine - just log it
        if (!err.message?.includes('not found') && !err.message?.includes('already')) {
          errors.push(`Failed to remove seat ${seatId}: ${err.message}`);
        }
      }
    }
    
    if (fixedCount > 0) {
      log(`✅ Auto-fix completed: Fixed ${fixedCount} integrity issues`);
    }
    
  } catch (err: any) {
    logError('Auto-fix error:', err);
    errors.push(`Auto-fix failed: ${err.message}`);
  }
  
  return { fixed: fixedCount, errors };
}

export async function findDoubleSeatingIssues(clubDayId: string): Promise<DoubleSeatingIssue[]> {
  // Get all active seats for this club day
  const { data: allSeats } = await getClient().models.TableSeat.list({
    filter: {
      and: [
        { clubDayId: { eq: clubDayId } },
        { leftAt: { attributeExists: false } },
      ],
    },
  });

  if (!allSeats || allSeats.length === 0) {
    return [];
  }

  // Group seats by playerId
  type SeatType = NonNullable<typeof allSeats>[number];
  const seatsByPlayer = new Map<string, SeatType[]>();
  for (const seat of allSeats) {
    if (!seat.playerId) continue;
    if (!seatsByPlayer.has(seat.playerId)) {
      seatsByPlayer.set(seat.playerId, []);
    }
    seatsByPlayer.get(seat.playerId)!.push(seat);
  }

  // Find players with multiple seats
  const issues: DoubleSeatingIssue[] = [];
  for (const [playerId, seats] of seatsByPlayer.entries()) {
    if (seats.length > 1) {
      // Get player info
      let playerNick: string | undefined;
      let playerName: string | undefined;
      try {
        const { data: playerData } = await getClient().models.Player.get({ id: playerId });
        if (playerData) {
          playerNick = playerData.nick;
          playerName = playerData.name;
        }
      } catch {
        // Player might not exist
      }

      // Get table numbers for each seat
      const seatDetails = await Promise.all(
        seats.map(async (seat: SeatType) => {
          let tableNumber: number | undefined;
          try {
            const { data: tableData } = await getClient().models.PokerTable.get({ id: seat.tableId });
            tableNumber = tableData?.tableNumber;
          } catch {
            // Table might not exist
          }
          return {
            seatId: seat.id,
            tableId: seat.tableId,
            tableNumber,
            seatedAt: seat.seatedAt,
          };
        })
      );

      // Sort by seatedAt (most recent first)
      seatDetails.sort((a, b) => new Date(b.seatedAt).getTime() - new Date(a.seatedAt).getTime());

      issues.push({
        playerId,
        playerNick,
        playerName,
        seats: seatDetails,
      });
    }
  }

  return issues;
}

export async function fixDoubleSeatingIssue(
  playerId: string,
  clubDayId: string,
  keepSeatId: string,
  adminUser: string
): Promise<void> {
  // Get all seats for this player
  const existingSeats = await getSeatedPlayersForPlayer(playerId, clubDayId);
  
  // Remove all seats except the one to keep
  for (const seat of existingSeats) {
    if (seat.id !== keepSeatId) {
      await removePlayerFromSeat(seat.id, seat.table_id, adminUser);
    }
  }
}

export async function removePlayerFromSeat(seatId: string, tableId: string, adminUser: string): Promise<void> {
  log('Attempting to remove player from seat:', { seatId, tableId, adminUser });

  // Use direct GraphQL mutation to avoid Player relationship resolution issues
  // (localStorage-only players don't exist in DynamoDB, causing .get()/.update() to fail)
  const mutation = `
    mutation UpdateTableSeat($input: UpdateTableSeatInput!) {
      updateTableSeat(input: $input) {
        id
        leftAt
      }
    }
  `;

  try {
    const result = await getClient().graphql({
      query: mutation,
      variables: {
        input: {
          id: seatId,
          leftAt: new Date().toISOString(),
        }
      }
    });
    log('TableSeat removal successful:', result);
  } catch (error: any) {
    logError('GraphQL seat removal error:', error);

    // Extract meaningful error message
    if (error.errors && Array.isArray(error.errors)) {
      const errorMessages = error.errors.map((e: any) => e.message || e.errorType || e).join('; ');
      throw new Error(`Failed to remove player from seat: ${errorMessages}`);
    }
    if (error.message) {
      throw new Error(`Failed to remove player from seat: ${error.message}`);
    }
    throw error;
  }
}

// Waitlist functions
/**
 * Get all waitlist players for a table.
 * 
 * CRITICAL: This function MUST use a high limit (1000) to ensure all players are fetched.
 * Without this limit, pagination may not fetch all results, causing incorrect counts.
 * 
 * DO NOT remove or reduce the limit parameter - it will break player counting.
 * 
 * See docs/PAGINATION_CRITICAL_FIX.md for full documentation.
 */
export async function getWaitlistForTable(tableId: string, clubDayId?: string, authMode?: string): Promise<TableWaitlist[]> {
  // CRITICAL: Fetch ALL waitlist players with explicit limit to ensure we get all results
  // DO NOT remove or reduce this limit - it will cause incorrect player counts
  const PAGINATION_LIMIT = 1000; // CRITICAL: Must be >= 100 to avoid pagination issues
  if (PAGINATION_LIMIT < 100) {
    logError('CRITICAL: PAGINATION_LIMIT is too low! This will break player counting. See docs/PAGINATION_CRITICAL_FIX.md');
    throw new Error('PAGINATION_LIMIT must be >= 100');
  }
  
  // CRITICAL: Build filter - always exclude removed waitlist entries, optionally filter by clubDayId
  const filterConditions: any[] = [
    { tableId: { eq: tableId } },
    { removedAt: { attributeExists: false } },
  ];
  
  // CRITICAL: If clubDayId is provided, filter by it to prevent showing players from old club days
  // This ensures that after a day reset, old waitlist entries don't appear
  if (clubDayId) {
    filterConditions.push({ clubDayId: { eq: clubDayId } });
  }
  
  const listOpts: any = {
    filter: {
      and: filterConditions,
    },
    limit: PAGINATION_LIMIT, // CRITICAL: Explicitly set high limit to get all players - DO NOT REMOVE
  };
  if (authMode) listOpts.authMode = authMode;
  const { data } = await getClient().models.TableWaitlist.list(listOpts);
  
  // Convert to TableWaitlist format and sort by position for consistent ordering across all views
  const waitlist: TableWaitlist[] = (data || []).map(toTableWaitlist);
  waitlist.sort((a, b) => (a.position || 0) - (b.position || 0));
  
  // Enrich with player data from localStorage (faster than backend lookup)
  try {
    const { enrichArrayWithPlayerData } = await import('./localStoragePlayers');
    return enrichArrayWithPlayerData(waitlist);
  } catch (error) {
    // Fallback to backend lookup if localStorage enrichment fails
    for (const entry of waitlist) {
      if (!entry.player && entry.player_id) {
        try {
          const { data: playerData } = await getClient().models.Player.get({ id: entry.player_id });
          if (playerData) {
            entry.player = toPlayer(playerData);
          }
        } catch (err) {
          // Player not found in backend, that's okay - will show as "Unknown"
        }
      }
    }
    return waitlist;
  }
}

export async function addPlayerToWaitlist(
  tableId: string,
  playerId: string,
  clubDayId: string,
  _adminUser: string,
  options?: { skipSeatCheck?: boolean; calledIn?: boolean; atTop?: boolean }
): Promise<TableWaitlist> {
  if (!options?.skipSeatCheck) {
    // Only check if player is already seated at THIS table - allow waitlisting at other tables
    // CRITICAL: Pass clubDayId to prevent finding seats from old club days
    const seatedPlayers = await getSeatedPlayersForTable(tableId, clubDayId);
    const isAlreadySeated = seatedPlayers.some(seat => seat.player_id === playerId);

    if (isAlreadySeated) {
      throw new Error(`Player is already seated at this table and cannot be added to the waitlist`);
    }
  }

  // Check if player is already on waitlist
  const waitlist = await getWaitlistForTable(tableId, clubDayId);
  const existingEntry = waitlist.find(entry => entry.player_id === playerId && !entry.removed_at);
  if (existingEntry) {
    return existingEntry;
  }

  let position: number;
  if (options?.atTop) {
    // Shift all existing entries down by 1
    position = 1;
    const sorted = [...waitlist].sort((a, b) => (a.position || 0) - (b.position || 0));
    for (const entry of sorted) {
      try {
        await getClient().models.TableWaitlist.update({ id: entry.id, position: (entry.position || 0) + 1 });
      } catch { /* best effort */ }
    }
  } else {
    position = waitlist.length + 1;
  }

  // Determine addedAt: controls sort order in merged (cross-table) views.
  // For atTop (TC players): set to 1s before earliest existing entry so they appear first.
  // For normal adds: use current time so new players always go to the bottom.
  let addedAt = new Date().toISOString();
  if (options?.atTop && waitlist.length > 0) {
    const sorted = [...waitlist].sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
    const earliest = new Date(sorted[0].added_at).getTime();
    addedAt = new Date(earliest - 1000).toISOString();
  }

  const { data } = await getClient().models.TableWaitlist.create({
    tableId,
    playerId,
    clubDayId,
    position,
    addedAt,
    calledIn: options?.calledIn || false,
  });
  if (!data) throw new Error('Failed to add player to waitlist');
  const entry = toTableWaitlist(data);
  try {
    const { enrichWithPlayerData } = await import('./localStoragePlayers');
    return enrichWithPlayerData(entry);
  } catch {
    return entry;
  }
}

/**
 * Move a waitlist entry up or down by one position within the same table.
 * Swaps positions with the adjacent entry.
 */
export async function reorderWaitlistPosition(
  entryId: string,
  tableId: string,
  clubDayId: string,
  direction: 'up' | 'down',
  playerId?: string
): Promise<void> {
  const waitlist = await getWaitlistForTable(tableId, clubDayId);
  log('🔀 reorderWaitlistPosition - waitlist count:', waitlist.length, 'entryId:', entryId, 'playerId:', playerId, 'direction:', direction);
  log('🔀 reorderWaitlistPosition - waitlist IDs:', waitlist.map(w => `${w.id}(pos:${w.position})`));
  const sorted = [...waitlist].sort((a, b) => (a.position || 0) - (b.position || 0));
  // Try exact ID match first; fall back to player_id for optimistic (temp-) entries
  let idx = sorted.findIndex(w => w.id === entryId);
  if (idx === -1 && playerId) {
    idx = sorted.findIndex(w => w.player_id === playerId);
    if (idx !== -1) log('🔀 Found entry by player_id fallback at idx:', idx);
  }
  if (idx === -1) {
    logWarn('🔀 reorderWaitlistPosition - entry not found, entryId:', entryId, 'playerId:', playerId);
    return;
  }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) {
    logWarn('🔀 reorderWaitlistPosition - already at boundary, idx:', idx, 'swapIdx:', swapIdx, 'length:', sorted.length);
    return;
  }

  // Assign index-based positions if not set, ensuring distinct values for a real swap
  const posA = sorted[idx].position != null && sorted[idx].position !== 0 ? sorted[idx].position : idx + 1;
  const posB = sorted[swapIdx].position != null && sorted[swapIdx].position !== 0 ? sorted[swapIdx].position : swapIdx + 1;
  // If positions are identical (both unset), force distinct values
  const finalPosA = posA === posB ? idx + 1 : posA;
  const finalPosB = posA === posB ? swapIdx + 1 : posB;

  log('🔀 Swapping positions:', sorted[idx].id, 'pos', posA, '->', finalPosB, 'AND', sorted[swapIdx].id, 'pos', posB, '->', finalPosA);

  try {
    const result1 = await getClient().models.TableWaitlist.update({ id: sorted[idx].id, position: finalPosB });
    log('🔀 Update 1 result:', result1);
    const result2 = await getClient().models.TableWaitlist.update({ id: sorted[swapIdx].id, position: finalPosA });
    log('🔀 Update 2 result:', result2);
  } catch (err) {
    logError('🔀 reorderWaitlistPosition update failed:', err);
    throw err;
  }
}

/**
 * Swap addedAt timestamps between two waitlist entries.
 * Used by merged (cross-table) views where position is per-table but addedAt is global.
 */
export async function swapWaitlistAddedAt(entryIdA: string, entryIdB: string): Promise<void> {
  const client = getClient();
  const { data: a } = await client.models.TableWaitlist.get({ id: entryIdA });
  const { data: b } = await client.models.TableWaitlist.get({ id: entryIdB });
  if (!a || !b) throw new Error('Waitlist entry not found');
  const addedAtA = a.addedAt;
  const addedAtB = b.addedAt;
  // If timestamps are identical, offset by 1ms to ensure distinct ordering
  if (addedAtA === addedAtB) {
    const ts = new Date(addedAtA).getTime();
    await client.models.TableWaitlist.update({ id: entryIdA, addedAt: new Date(ts + 1).toISOString() });
    await client.models.TableWaitlist.update({ id: entryIdB, addedAt: new Date(ts - 1).toISOString() });
  } else {
    await client.models.TableWaitlist.update({ id: entryIdA, addedAt: addedAtB });
    await client.models.TableWaitlist.update({ id: entryIdB, addedAt: addedAtA });
  }
}

/**
 * Move a waitlist entry to the bottom of the list by setting its addedAt
 * timestamp to be later than every other active entry in the same club day.
 */
export async function sendWaitlistToBottom(entryId: string, clubDayId: string): Promise<void> {
  const client = getClient();
  // Get all active waitlist entries for this club day
  const { data } = await client.models.TableWaitlist.list({
    filter: {
      and: [
        { clubDayId: { eq: clubDayId } },
        { removedAt: { attributeExists: false } },
      ],
    },
    limit: 1000,
  });
  if (!data || data.length === 0) return;

  // Find the latest addedAt across all entries
  let latestMs = 0;
  for (const entry of data) {
    const ms = new Date(entry.addedAt).getTime();
    if (ms > latestMs) latestMs = ms;
  }

  // Set this entry's addedAt to 1 second after the latest
  const newAddedAt = new Date(latestMs + 1000).toISOString();
  await client.models.TableWaitlist.update({ id: entryId, addedAt: newAddedAt });
}

export type MoveTargetType = 'seat' | 'waitlist' | 'auto';

export async function movePlayerEntry(params: {
  playerId: string;
  fromTableId: string;
  fromWaitlist: boolean;
  entryId: string;
  toTableId: string;
  clubDayId: string;
  adminUser: string;
  target: MoveTargetType;
}): Promise<{ finalTarget: 'seat' | 'waitlist' }> {
  const {
    playerId,
    fromTableId,
    fromWaitlist,
    entryId,
    toTableId,
    clubDayId,
    adminUser,
    target,
  } = params;

  if (fromWaitlist) {
    await removePlayerFromWaitlist(entryId, adminUser);
  } else {
    await removePlayerFromSeat(entryId, fromTableId, adminUser);
  }

  let finalTarget: 'seat' | 'waitlist' = target === 'waitlist' ? 'waitlist' : 'seat';

  if (target === 'auto') {
    const { data: tableData } = await getClient().models.PokerTable.get({ id: toTableId });
    if (!tableData?.seatsTotal) {
      throw new Error('Target table not found');
    }
    // CRITICAL: Pass clubDayId to prevent counting seats from old club days
    const currentSeats = await getSeatedPlayersForTable(toTableId, clubDayId);
    finalTarget = currentSeats.length >= tableData.seatsTotal ? 'waitlist' : 'seat';
  }

  if (finalTarget === 'seat') {
    const { data: tableData } = await getClient().models.PokerTable.get({ id: toTableId });
    if (!tableData?.seatsTotal) {
      throw new Error('Target table not found');
    }
    await seatPlayer(toTableId, playerId, clubDayId);
  } else {
    await addPlayerToWaitlist(toTableId, playerId, clubDayId, adminUser, { skipSeatCheck: true });
  }

  return { finalTarget };
}

export interface BulkMoveEntry {
  playerId: string;
  fromWaitlist: boolean;
  entryId: string;
  target: 'seat' | 'waitlist';
}

export interface BulkMoveResult {
  playerId: string;
  success: boolean;
  error?: string;
  finalTarget?: 'seat' | 'waitlist';
}

/**
 * Optimized bulk move function that processes moves in parallel batches
 * for much better performance than sequential moves.
 */
export async function bulkMovePlayers(params: {
  entries: BulkMoveEntry[];
  fromTableId: string;
  toTableId: string;
  clubDayId: string;
  adminUser: string;
}): Promise<BulkMoveResult[]> {
  const { entries, fromTableId, toTableId, clubDayId, adminUser } = params;

  if (entries.length === 0) return [];

  // Pre-fetch target table capacity once
  const { data: tableData } = await getClient().models.PokerTable.get({ id: toTableId });
  if (!tableData?.seatsTotal) {
    throw new Error('Target table not found');
  }

  const targetCapacity = tableData.seatsTotal;
  // CRITICAL: Pass clubDayId to prevent counting seats from old club days
  const currentSeats = await getSeatedPlayersForTable(toTableId, clubDayId);
  let availableSeats = Math.max(0, targetCapacity - currentSeats.length);

  // Step 1: Remove all players from source table in parallel
  const removalPromises = entries.map(async (entry) => {
    try {
      if (entry.fromWaitlist) {
        await removePlayerFromWaitlist(entry.entryId, adminUser);
      } else {
        await removePlayerFromSeat(entry.entryId, fromTableId, adminUser);
      }
      return { playerId: entry.playerId, success: true };
    } catch (err: any) {
      return { playerId: entry.playerId, success: false, error: err?.message || 'Failed to remove' };
    }
  });

  const removalResults = await Promise.all(removalPromises);
  const failedRemovals = new Set(removalResults.filter(r => !r.success).map(r => r.playerId));

  // Step 2: Separate entries into seats and waitlist, respecting capacity
  const seatEntries: BulkMoveEntry[] = [];
  const waitlistEntries: BulkMoveEntry[] = [];

  for (const entry of entries) {
    if (failedRemovals.has(entry.playerId)) {
      continue; // Skip entries that failed removal
    }

    if (entry.target === 'seat') {
      if (availableSeats > 0) {
        seatEntries.push(entry);
        availableSeats--;
      } else {
        // Auto-downgrade to waitlist if no seats available
        waitlistEntries.push({ ...entry, target: 'waitlist' });
      }
    } else {
      waitlistEntries.push(entry);
    }
  }

  // Step 3: Process seat additions in parallel
  // Note: seatPlayer will check capacity again, but we've pre-allocated based on initial capacity
  const seatPromises = seatEntries.map(async (entry) => {
    try {
      await seatPlayer(toTableId, entry.playerId, clubDayId);
      return { playerId: entry.playerId, success: true, finalTarget: 'seat' as const };
    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to seat';
      // If seating fails due to capacity or double-seating, try waitlist as fallback
      if (errorMsg.includes('full') || errorMsg.includes('capacity') || errorMsg.includes('already seated')) {
        try {
          await addPlayerToWaitlist(toTableId, entry.playerId, clubDayId, adminUser, { skipSeatCheck: true });
          return { playerId: entry.playerId, success: true, finalTarget: 'waitlist' as const, error: 'Table full, moved to waitlist' };
        } catch (waitlistErr: any) {
          return { playerId: entry.playerId, success: false, error: errorMsg };
        }
      }
      return { playerId: entry.playerId, success: false, error: errorMsg };
    }
  });

  // Step 4: Process waitlist additions in parallel
  const waitlistPromises = waitlistEntries.map(async (entry) => {
    try {
      await addPlayerToWaitlist(toTableId, entry.playerId, clubDayId, adminUser, { skipSeatCheck: true });
      return { playerId: entry.playerId, success: true, finalTarget: 'waitlist' as const };
    } catch (err: any) {
      return { playerId: entry.playerId, success: false, error: err?.message || 'Failed to add to waitlist' };
    }
  });

  // Execute both batches in parallel
  const [seatResults, waitlistResults] = await Promise.all([
    Promise.all(seatPromises),
    Promise.all(waitlistPromises),
  ]);

  // Combine all results
  const allResults = [...seatResults, ...waitlistResults];

  // Add failed removals to results
  removalResults.forEach(r => {
    if (!r.success && !allResults.find(res => res.playerId === r.playerId)) {
      allResults.push({ playerId: r.playerId, success: false, error: r.error });
    }
  });

  return allResults;
}

/**
 * Remove a player from ALL waitlists for a given club day.
 * Used when a player is busted out — they should not remain on any waitlists.
 */
export async function removePlayerFromAllWaitlists(playerId: string, clubDayId: string): Promise<number> {
  const { data } = await getClient().models.TableWaitlist.list({
    filter: {
      and: [
        { playerId: { eq: playerId } },
        { clubDayId: { eq: clubDayId } },
        { removedAt: { attributeExists: false } },
      ],
    },
    limit: 1000,
  });

  let removed = 0;
  for (const entry of (data || [])) {
    try {
      await removePlayerFromWaitlist(entry.id, 'system');
      removed++;
    } catch {
      // Best-effort — continue removing others
    }
  }
  return removed;
}

export async function removePlayerFromWaitlist(waitlistId: string, _adminUser: string): Promise<void> {
  // Use direct GraphQL mutation to avoid relationship resolution issues
  const mutation = `
    mutation UpdateTableWaitlist($input: UpdateTableWaitlistInput!) {
      updateTableWaitlist(input: $input) {
        id
        removedAt
      }
    }
  `;

  await getClient().graphql({
    query: mutation,
    variables: {
      input: {
        id: waitlistId,
        removedAt: new Date().toISOString(),
      }
    }
  });
}

export async function seatNextFromWaitlist(tableId: string, clubDayId: string, adminUser: string, doorFeeAmount?: number): Promise<void> {
  // CRITICAL: Pass clubDayId to prevent getting waitlist entries from old club days
  const waitlist = await getWaitlistForTable(tableId, clubDayId);
  if (waitlist.length === 0) throw new Error('Waitlist is empty');
  
  const next = waitlist[0];
  
  // If player is called in and door fee is provided, charge door fee and seat
  if (next.called_in && doorFeeAmount !== undefined && doorFeeAmount > 0) {
    // seatCalledInPlayer internally calls seatPlayer, which already removes the waitlist entry
    await seatCalledInPlayer(tableId, next.player_id, clubDayId, doorFeeAmount, adminUser);
    // No need to remove from waitlist - seatPlayer already handles it
  } else if (next.called_in) {
    // Called-in player but no door fee provided - can't seat without payment
    throw new Error(`Player ${next.player?.nick || 'Unknown'} is called in and needs to pay door fee before being seated. Use "Pay & Seat" button instead.`);
  } else {
    // Regular waitlist player - seat normally
    // seatPlayer already removes the waitlist entry, so no need to call removePlayerFromWaitlist
    await seatPlayer(tableId, next.player_id, clubDayId);
  }
  
  // Reorder remaining waitlist positions using direct GraphQL to avoid relationship issues
  for (let i = 1; i < waitlist.length; i++) {
    const positionMutation = `
      mutation UpdateTableWaitlist($input: UpdateTableWaitlistInput!) {
        updateTableWaitlist(input: $input) {
          id
          position
        }
      }
    `;

    await getClient().graphql({
      query: positionMutation,
      variables: {
        input: {
          id: waitlist[i].id,
          position: i,
        }
      }
    });
  }
}

// CheckIn functions
/**
 * Gets the check-in for a player for a specific club day.
 * 
 * IMPORTANT: This function only returns check-ins for the specified clubDayId.
 * When a day is reset and a new ClubDay is created, check-ins from previous days
 * are automatically excluded because they're tied to the old clubDayId.
 * This ensures that players who checked in on a previous day will NOT show
 * as checked in for the new day - each day starts with a clean slate.
 * 
 * @param playerId - The player's ID
 * @param clubDayId - The club day ID (must be the current active day's ID)
 * @returns The check-in record if found, null otherwise
 */
export async function getCheckInForPlayer(playerId: string, clubDayId: string): Promise<CheckIn | null> {
  const { data } = await getClient().models.CheckIn.list({
    filter: {
      and: [
        { playerId: { eq: playerId } },
        { clubDayId: { eq: clubDayId } },
        { refundedAt: { attributeExists: false } },
      ],
    },
  });
  if (!data || data.length === 0) return null;
  return toCheckIn(data[0]);
}

/**
 * ⚠️ CRITICAL: Get all check-ins for a club day with pagination
 * 
 * This function must handle pagination to ensure ALL check-ins are retrieved.
 * Missing check-ins will cause refund search to fail to find players.
 * 
 * CRITICAL: Uses limit: 1000 to fetch all check-ins in a single page.
 * If more than 1000 check-ins exist, pagination will be handled by the
 * graphql-client's recursive pagination logic.
 */
export async function getCheckInsForClubDay(clubDayId: string, includeRefunded = true): Promise<CheckIn[]> {
  const filter: any = includeRefunded
    ? { clubDayId: { eq: clubDayId } }
    : { and: [{ clubDayId: { eq: clubDayId } }, { refundedAt: { attributeExists: false } }] };

  let allData: any[] = [];
  let nextToken: string | undefined = undefined;
  // Paginate to handle days with more than 1000 check-ins
  do {
    const result: any = await getClient().models.CheckIn.list({
      filter,
      limit: 1000,
      ...(nextToken ? { nextToken } : {}),
    });
    allData = allData.concat(result.data || []);
    nextToken = result.nextToken;
  } while (nextToken);

  return allData.map(toCheckIn);
}

// Ledger functions - Core accounting system
/**
 * Gets the current balance for a club day by summing all ledger entries
 */
async function getCurrentLedgerBalance(clubDayId: string): Promise<number> {
  try {
    const client = getClient();
    
    // Guard: check if LedgerEntry model is available
    if (!client?.models?.LedgerEntry) {
      logWarn('LedgerEntry model not available - returning 0 balance');
      return 0;
    }
    
    const result = await client.models.LedgerEntry.list({
      filter: { clubDayId: { eq: clubDayId } },
    }).catch((error: any) => {
      logWarn('LedgerEntry.list failed - model may not exist:', error);
      return { data: [] };
    });
    
    const entries = result.data;
    if (!entries || entries.length === 0) return 0;
    
    // Sum all entry amounts for accuracy — do NOT trust stored balance field
    // which could be stale if a sequence collision occurred
    return entries.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
  } catch (error: any) {
    logError('Error getting current ledger balance:', error);
    return 0;
  }
}

/**
 * Gets the next sequence number for a club day
 * Fetches fresh data each time to minimize race conditions
 */
async function getNextSequenceNumber(clubDayId: string): Promise<number> {
  try {
    const client = getClient();
    
    // Guard: check if LedgerEntry model is available
    if (!client?.models?.LedgerEntry) {
      logWarn('LedgerEntry model not available - starting at sequence 1');
      return 1;
    }
    
    const result = await client.models.LedgerEntry.list({
      filter: { clubDayId: { eq: clubDayId } },
    }).catch((error: any) => {
      logWarn('LedgerEntry.list failed - model may not exist:', error);
      return { data: [] };
    });
    
    const entries = result.data;
    if (!entries || entries.length === 0) return 1;
    
    const maxSequence = Math.max(...entries.map((e: any) => e.sequenceNumber || 0));
    return maxSequence + 1;
  } catch (error: any) {
    logError('Error getting next sequence number:', error);
    // If LedgerEntry model doesn't exist or has errors, start at 1
    return 1;
  }
}

/**
 * Helper to sleep for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a ledger entry atomically with retry logic for race condition handling
 * This is the single source of truth for all financial transactions
 * Retries up to 3 times if sequence number collision occurs
 */
async function createLedgerEntry(params: {
  clubDayId: string;
  transactionType: 'checkin' | 'refund';
  amount: number; // Positive for checkin, negative for refund
  checkinId?: string;
  refundId?: string;
  receiptId: string;
  playerId: string;
  adminUser?: string;
  notes?: string;
}): Promise<LedgerEntry> {
  const { clubDayId, transactionType, amount, checkinId, refundId, receiptId, playerId, adminUser, notes } = params;
  
  // Validate amount matches transaction type
  if (transactionType === 'checkin' && amount <= 0) {
    throw new Error('Check-in amount must be positive');
  }
  if (transactionType === 'refund' && amount >= 0) {
    throw new Error('Refund amount must be negative');
  }
  
  // Validate no duplicate transactions before attempting creation
  if (checkinId) {
    try {
      const existing = await getClient().models.LedgerEntry.list({
        filter: {
          and: [
            { clubDayId: { eq: clubDayId } },
            { checkinId: { eq: checkinId } },
          ],
        },
      });
      if (existing.data && existing.data.length > 0) {
        throw new Error(`Ledger entry already exists for check-in ${checkinId}`);
      }
    } catch (error: any) {
      // If listing fails due to model/permission issues, continue anyway
      // The create operation will fail if there's a true duplicate
      if (!error.message?.includes('already exists')) {
        logWarn('Could not check for duplicate ledger entry (may not be critical):', error);
      } else {
        throw error;
      }
    }
  }
  
  if (refundId) {
    try {
      const existing = await getClient().models.LedgerEntry.list({
        filter: {
          and: [
            { clubDayId: { eq: clubDayId } },
            { refundId: { eq: refundId } },
          ],
        },
      });
      if (existing.data && existing.data.length > 0) {
        throw new Error(`Ledger entry already exists for refund ${refundId}`);
      }
    } catch (error: any) {
      // If listing fails due to model/permission issues, continue anyway
      // The create operation will fail if there's a true duplicate
      if (!error.message?.includes('already exists')) {
        logWarn('Could not check for duplicate ledger entry (may not be critical):', error);
      } else {
        throw error;
      }
    }
  }
  
  // Retry logic for sequence number race condition
  const MAX_RETRIES = 3;
  let lastError: any = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Get fresh balance and sequence number on each attempt
      const currentBalance = await getCurrentLedgerBalance(clubDayId);
      const sequenceNumber = await getNextSequenceNumber(clubDayId);
      const newBalance = currentBalance + amount;
      
      // Create ledger entry using the GraphQL client
      const result = await getClient().models.LedgerEntry.create({
        clubDayId,
        sequenceNumber,
        transactionType,
        amount,
        balance: newBalance,
        checkinId: checkinId || undefined,
        refundId: refundId || undefined,
        receiptId,
        playerId,
        transactionTime: new Date().toISOString(),
        adminUser: adminUser || undefined,
        notes: notes || undefined,
      });
      
      if (!result.data) {
        throw new Error('Failed to create ledger entry: no data returned');
      }
      
      // Success - verify no duplicate sequence number was created
      let verifyResult;
      try {
        verifyResult = await getClient().models.LedgerEntry.list({
          filter: {
            and: [
              { clubDayId: { eq: clubDayId } },
              { sequenceNumber: { eq: sequenceNumber } },
            ],
          },
        });
      } catch (verifyError: any) {
        // If verification fails, assume success (ledger might not be fully set up)
        logWarn('Could not verify ledger entry sequence number (non-critical):', verifyError);
        return toLedgerEntry(result.data);
      }
      
      // If multiple entries with same sequence number, we have a collision
      if (verifyResult.data && verifyResult.data.length > 1) {
        // Check if this is our entry (by receiptId or checkinId/refundId)
        const ourEntry = verifyResult.data.find((e: any) => 
          e.receiptId === receiptId || 
          (checkinId && e.checkinId === checkinId) ||
          (refundId && e.refundId === refundId)
        );
        
        if (ourEntry) {
          // Our entry exists, but there's a duplicate - this is acceptable if ours is first
          // Return our entry
          return toLedgerEntry(ourEntry);
        } else {
          // Collision detected, retry with new sequence number
          if (attempt < MAX_RETRIES - 1) {
            const backoffMs = Math.min(50 * Math.pow(2, attempt), 200); // Exponential backoff: 50ms, 100ms, 200ms
            await sleep(backoffMs);
            continue;
          }
        }
      }
      
      return toLedgerEntry(result.data);
    } catch (error: any) {
      lastError = error;
      const errorMessage = extractErrorMessage(error);
      
      // Check if error is due to sequence number conflict (would need to check error details)
      // For now, retry on any error except duplicate transaction errors
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        // Don't retry duplicate errors - these are validation failures
        throw error;
      }
      
      // Retry on other errors with exponential backoff
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = Math.min(50 * Math.pow(2, attempt), 200);
        log(`Ledger entry creation attempt ${attempt + 1} failed, retrying in ${backoffMs}ms:`, errorMessage);
        await sleep(backoffMs);
        continue;
      }
    }
  }
  
  // All retries exhausted
  const errorMessage = extractErrorMessage(lastError);
  logError('Error in createLedgerEntry after retries:', {
    errorMessage,
    error: lastError,
    params: {
      clubDayId,
      transactionType,
      amount,
      checkinId,
      refundId,
      receiptId,
      playerId,
    },
  });
  
  if (!lastError?.message && typeof lastError !== 'string') {
    throw new Error(`Failed to create ledger entry after ${MAX_RETRIES} attempts: ${errorMessage}`);
  }
  throw lastError;
}

/**
 * Gets all ledger entries for a club day
 */
export async function getLedgerEntries(clubDayId: string): Promise<LedgerEntry[]> {
  const { data: entries } = await getClient().models.LedgerEntry.list({
    filter: { clubDayId: { eq: clubDayId } },
  });
  
  if (!entries) return [];
  
  return entries
    .map(toLedgerEntry)
    .sort((a: LedgerEntry, b: LedgerEntry) => a.sequence_number - b.sequence_number);
}

/**
 * Reconciles ledger balance with check-ins and refunds
 * Returns any discrepancies found
 */
export async function reconcileLedger(clubDayId: string): Promise<{
  ledgerBalance: number;
  calculatedBalance: number;
  discrepancy: number;
  checkinTotal: number;
  refundTotal: number;
  ledgerEntryCount: number;
  checkinCount: number;
  refundCount: number;
  issues: string[];
}> {
  const issues: string[] = [];
  
  // Get ledger balance
  const ledgerBalance = await getCurrentLedgerBalance(clubDayId);
  const ledgerEntries = await getLedgerEntries(clubDayId);
  
  // Calculate from source data
  const checkIns = await getClient().models.CheckIn.list({
    filter: {
      and: [
        { clubDayId: { eq: clubDayId } },
        { refundedAt: { attributeExists: false } },
      ],
    },
  });
  
  const refunds = await getClient().models.Refund.list({
    filter: {
      checkinId: {
        in: (checkIns.data || []).map((ci: any) => ci.id),
      },
    },
  });
  
  const checkinTotal = (checkIns.data || []).reduce((sum: number, ci: any) => sum + (ci.doorFeeAmount || 0), 0);
  const refundTotal = (refunds.data || []).reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  const calculatedBalance = checkinTotal - refundTotal;
  
  // Check for missing ledger entries
  const checkinIds = new Set<string>((checkIns.data || []).map((ci: any) => ci.id as string));
  const refundIds = new Set<string>((refunds.data || []).map((r: any) => r.id as string));
  const ledgerCheckinIds = new Set<string>(ledgerEntries.filter(e => e.checkin_id).map(e => e.checkin_id!));
  const ledgerRefundIds = new Set<string>(ledgerEntries.filter(e => e.refund_id).map(e => e.refund_id!));
  
  for (const checkinId of checkinIds) {
    if (!ledgerCheckinIds.has(checkinId)) {
      issues.push(`Missing ledger entry for check-in ${checkinId}`);
    }
  }
  
  for (const refundId of refundIds) {
    if (!ledgerRefundIds.has(refundId)) {
      issues.push(`Missing ledger entry for refund ${refundId}`);
    }
  }
  
  const discrepancy = Math.abs(ledgerBalance - calculatedBalance);
  if (discrepancy > 0.01) { // Allow for floating point rounding
    issues.push(`Balance mismatch: Ledger shows $${ledgerBalance.toFixed(2)} but calculated balance is $${calculatedBalance.toFixed(2)}`);
  }
  
  return {
    ledgerBalance,
    calculatedBalance,
    discrepancy,
    checkinTotal,
    refundTotal,
    ledgerEntryCount: ledgerEntries.length,
    checkinCount: checkIns.data?.length || 0,
    refundCount: refunds.data?.length || 0,
    issues,
  };
}

export async function createCheckIn(
  clubDayId: string,
  playerId: string,
  doorFeeAmount: number,
  paymentMethod: string,
  overrideReason?: string,
  adminUser?: string
): Promise<{ checkIn: CheckIn; receipt: Receipt }> {
  try {
    log('createCheckIn called with:', {
      clubDayId,
      playerId,
      doorFeeAmount,
      paymentMethod,
      overrideReason,
      adminUser
    });

    // CRITICAL: Verify clubDayId matches the active club day to ensure door fees are tracked correctly
    const activeClubDay = await getActiveClubDay();
    if (!activeClubDay) {
      throw new Error('No active club day found. Cannot create check-in.');
    }
    if (activeClubDay.id !== clubDayId) {
      logWarn(`⚠️ Door Fee Safety Check: clubDayId mismatch!`, {
        provided: clubDayId,
        active: activeClubDay.id,
        activeStatus: activeClubDay.status
      });
      // Use the active club day ID instead of the provided one
      // This ensures door fees are always tracked for the correct day
      clubDayId = activeClubDay.id;
      log(`✅ Corrected clubDayId to active day: ${clubDayId}`);
    }

    // Retry logic for receipt number race condition
    const MAX_RETRIES = 3;
    let lastError: any = null;
    let receiptData: any = null;
    let checkInData: any = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Get fresh receipt count on each attempt to minimize race conditions
      const receipts = await getClient().models.Receipt.list({
        filter: { clubDayId: { eq: clubDayId } },
      });
      const nextReceiptNumber = (receipts.data?.length || 0) + 1;
      log(`Attempt ${attempt + 1}: Next receipt number:`, nextReceiptNumber);

      // Create receipt using direct GraphQL to avoid relationship resolution issues
      const receiptMutation = `
        mutation CreateReceipt($input: CreateReceiptInput!) {
          createReceipt(input: $input) {
            id
            clubDayId
            receiptNumber
            playerId
            amount
            paymentMethod
            kind
            createdBy
          }
        }
      `;

      const receiptResult = await getClient().graphql({
        query: receiptMutation,
        variables: {
          input: {
            clubDayId,
            receiptNumber: nextReceiptNumber,
            playerId,
            amount: doorFeeAmount,
            paymentMethod,
            kind: 'checkin',
            createdBy: adminUser,
          }
        }
      });

      if (!receiptResult.data?.createReceipt) throw new Error('Failed to create receipt');
      receiptData = receiptResult.data.createReceipt;
      
      // Verify receipt number is unique (check for duplicates)
      const verifyReceipts = await getClient().models.Receipt.list({
        filter: {
          and: [
            { clubDayId: { eq: clubDayId } },
            { receiptNumber: { eq: nextReceiptNumber } },
          ],
        },
      });
      
      // If multiple receipts with same number, check if ours is first
      if (verifyReceipts.data && verifyReceipts.data.length > 1) {
        const ourReceipt = verifyReceipts.data.find((r: any) => r.id === receiptData.id);
        if (!ourReceipt) {
          // Collision detected, retry with new receipt number
          if (attempt < MAX_RETRIES - 1) {
            const backoffMs = Math.min(50 * Math.pow(2, attempt), 200);
            log(`Receipt number collision detected, retrying in ${backoffMs}ms`);
            await sleep(backoffMs);
            continue;
          }
        }
      }

      log('Receipt created:', receiptData.id);

      // Create check-in using direct GraphQL to avoid relationship resolution issues
      const checkInMutation = `
        mutation CreateCheckIn($input: CreateCheckInInput!) {
          createCheckIn(input: $input) {
            id
            clubDayId
            playerId
            checkinTime
            doorFeeAmount
            paymentMethod
            receiptId
            overrideReason
            refundedAt
          }
        }
      `;

      const checkInResult = await getClient().graphql({
        query: checkInMutation,
        variables: {
          input: {
            clubDayId,
            playerId,
            checkinTime: new Date().toISOString(),
            doorFeeAmount,
            paymentMethod,
            receiptId: receiptData.id,
            overrideReason: overrideReason || undefined,
          }
        }
      });

      if (!checkInResult.data?.createCheckIn) throw new Error('Failed to create check-in');
      checkInData = checkInResult.data.createCheckIn;
      log('Check-in created:', checkInData.id);

      // Create ledger entry for this transaction (required for accounting integrity)
      try {
        await createLedgerEntry({
          clubDayId,
          transactionType: 'checkin',
          amount: doorFeeAmount,
          checkinId: checkInData.id,
          receiptId: receiptData.id,
          playerId,
          adminUser: adminUser || undefined,
          notes: overrideReason || undefined,
        });
        log('Ledger entry created for check-in');
      } catch (ledgerError: any) {
        // Ledger failure is non-fatal for check-in UX but must be logged prominently
        // The check-in and receipt are already created — reconciliation can recover this
        const errorMessage = extractErrorMessage(ledgerError);
        logError(`⚠️ LEDGER MISSING: Check-in ${checkInData.id} created but ledger entry failed: ${errorMessage}`);
        logWarn('Run reconcileLedger() to detect and repair missing ledger entries.');
      }

      // Success - break out of retry loop
      break;
    } catch (error: any) {
      lastError = error;
      const errorMessage = extractErrorMessage(error);
      
      // Don't retry on validation errors or duplicate errors
      if (errorMessage.includes('already exists') || 
          errorMessage.includes('duplicate') ||
          errorMessage.includes('already checked in')) {
        throw error;
      }
      
      // Retry on other errors
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = Math.min(50 * Math.pow(2, attempt), 200);
        log(`Check-in creation attempt ${attempt + 1} failed, retrying in ${backoffMs}ms:`, errorMessage);
        await sleep(backoffMs);
        continue;
      }
    }
  }

    // If we get here without success, all retries failed
    if (!receiptData || !checkInData) {
      const errorMessage = extractErrorMessage(lastError);
      logError('Failed to create check-in after retries:', {
        error: lastError,
        clubDayId,
        playerId,
        doorFeeAmount,
      });
      throw lastError || new Error(`Failed to create check-in after ${MAX_RETRIES} attempts: ${errorMessage}`);
    }

    return {
      checkIn: {
        id: checkInData.id,
        club_day_id: checkInData.clubDayId,
        player_id: checkInData.playerId,
        checkin_time: checkInData.checkinTime,
        door_fee_amount: checkInData.doorFeeAmount,
        payment_method: checkInData.paymentMethod,
        receipt_id: checkInData.receiptId,
        override_reason: checkInData.overrideReason,
        refunded_at: checkInData.refundedAt,
        created_at: checkInData.createdAt || new Date().toISOString(),
      },
      receipt: {
        id: receiptData.id,
        club_day_id: receiptData.clubDayId,
        receipt_number: receiptData.receiptNumber,
        player_id: receiptData.playerId,
        amount: receiptData.amount,
        payment_method: receiptData.paymentMethod,
        kind: receiptData.kind || 'checkin',
        created_by: receiptData.createdBy || undefined,
        created_at: receiptData.createdAt || new Date().toISOString(),
      },
    };
  } catch (error) {
    logError('Error in createCheckIn:', error);
    throw error;
  }
}

// Refund functions
export async function createRefund(
  checkinId: string,
  amount: number,
  reason: string,
  adminUser: string
): Promise<Refund> {
  const checkIn = await getClient().models.CheckIn.get({ id: checkinId });
  if (!checkIn.data) throw new Error('Check-in not found');

  // Validate amount is positive
  if (amount <= 0) throw new Error('Refund amount must be positive');

  // Validate check-in has not already been refunded
  if (checkIn.data.refundedAt) throw new Error('This check-in has already been refunded');

  // Validate refund amount does not exceed original door fee
  if (amount > (checkIn.data.doorFeeAmount || 0)) {
    throw new Error(`Refund amount ($${amount}) cannot exceed original door fee ($${checkIn.data.doorFeeAmount})`);
  }

  const clubDayId = checkIn.data.clubDayId;

  // Get next receipt number with retry logic to handle race conditions
  const MAX_RETRIES = 3;
  let refundReceipt: any = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const receipts = await getClient().models.Receipt.list({
      filter: { clubDayId: { eq: clubDayId } },
    });
    const nextReceiptNumber = (receipts.data?.length || 0) + 1;

    const { data: receipt } = await getClient().models.Receipt.create({
      clubDayId,
      receiptNumber: nextReceiptNumber,
      playerId: checkIn.data.playerId,
      amount: -amount,
      paymentMethod: 'cash',
      kind: 'refund',
      createdBy: adminUser,
    });

    if (receipt) {
      refundReceipt = receipt;
      break;
    }

    if (attempt < MAX_RETRIES - 1) {
      await sleep(Math.min(50 * Math.pow(2, attempt), 200));
    }
  }

  if (!refundReceipt) throw new Error('Failed to create refund receipt after retries');
  
  // Create refund record
  const { data: refundData } = await getClient().models.Refund.create({
    checkinId,
    refundReceiptId: refundReceipt.id,
    refundedAt: new Date().toISOString(),
    amount,
    reason,
    adminUser,
  });
  if (!refundData) throw new Error('Failed to create refund');

  // Mark check-in as refunded
  await getClient().models.CheckIn.update({
    id: checkinId,
    refundedAt: new Date().toISOString(),
  });

  // Create ledger entry for refund (required for accounting integrity)
  try {
    await createLedgerEntry({
      clubDayId,
      transactionType: 'refund',
      amount: -amount,
      refundId: refundData.id,
      receiptId: refundReceipt.id,
      playerId: checkIn.data.playerId,
      adminUser,
      notes: reason,
    });
    log('Ledger entry created for refund');
  } catch (ledgerError: any) {
    const errorMessage = extractErrorMessage(ledgerError);
    logError(`⚠️ LEDGER MISSING: Refund ${refundData.id} created but ledger entry failed: ${errorMessage}`);
    throw new Error(`Refund created but ledger entry failed: ${errorMessage}`);
  }
  
  return {
    id: refundData.id,
    checkin_id: refundData.checkinId,
    refund_receipt_id: refundData.refundReceiptId || undefined,
    refunded_at: refundData.refundedAt,
    amount: refundData.amount,
    reason: refundData.reason,
    admin_user: refundData.adminUser || undefined,
    created_at: refundData.createdAt || new Date().toISOString(),
  };
}

// Report functions
export async function getShiftReport(startTime: string, endTime: string): Promise<any> {
  // Fetch all check-ins in time window (include refunded for complete historical picture)
  const checkIns = await getClient().models.CheckIn.list({
    filter: {
      and: [
        { checkinTime: { ge: startTime } },
        { checkinTime: { le: endTime } },
      ],
    },
  });

  const refunds = await getClient().models.Refund.list({
    filter: {
      createdAt: {
        and: [
          { ge: startTime },
          { le: endTime },
        ],
      },
    },
  });

  const checkInsData: CheckIn[] = (checkIns.data || []).map(toCheckIn);
  const refundsData: Refund[] = (refunds.data || []).map(toRefund);
  
  // Separate active and refunded check-ins for reporting
  const activeCheckIns = checkInsData.filter(ci => !ci.refunded_at);
  const refundedCheckIns = checkInsData.filter(ci => !!ci.refunded_at);

  const totalDoorFees = checkInsData.reduce((sum: number, ci: CheckIn) => sum + ci.door_fee_amount, 0);
  const totalRefunds = refundsData.reduce((sum: number, refund: Refund) => sum + refund.amount, 0);
  const netTotal = totalDoorFees - totalRefunds;

  return {
    startTime,
    endTime,
    checkIns: checkInsData,
    activeCheckIns,
    refundedCheckIns,
    refunds: refundsData,
    total_door_fees: totalDoorFees,
    total_refunds: totalRefunds,
    net_total: netTotal,
    checkin_count: checkInsData.length,
    active_checkin_count: activeCheckIns.length,
    refund_count: refundsData.length,
  };
}

export async function getClubDayReport(clubDayId: string): Promise<any> {
  const clubDay = await getClient().models.ClubDay.get({ id: clubDayId });
  if (!clubDay.data) throw new Error('Club day not found');

  // Fetch ALL check-ins (including refunded) for counts, but only non-refunded for fee totals
  const allCheckIns = await getCheckInsForClubDay(clubDayId, true);
  const activeCheckIns = allCheckIns.filter(ci => !ci.refunded_at);
  const refundedCheckIns = allCheckIns.filter(ci => !!ci.refunded_at);

  // Guard: if no check-ins, there can be no refunds — skip the query entirely
  // (empty `in: []` filter returns ALL records in DynamoDB/AppSync)
  let refundsData: Refund[] = [];
  if (allCheckIns.length > 0) {
    const refunds = await getClient().models.Refund.list({
      filter: {
        checkinId: {
          in: allCheckIns.map(ci => ci.id),
        },
      },
    });
    refundsData = (refunds.data || []).map(toRefund);
  }

  // Fetch player names for all check-ins in this day
  const uniquePlayerIds = [...new Set(allCheckIns.map(ci => ci.player_id))];
  const playerNameMap = new Map<string, string>();

  // Step 1: Look up real DB Player records
  try {
    const result = await getClient().models.Player.list({ limit: 1000 });
    for (const p of result.data || []) {
      const displayName = (p.nick && p.nick.trim()) || (p.name && p.name.trim()) || 'Unknown';
      playerNameMap.set(p.id, displayName);
    }
  } catch (err) {
    logError('Failed to fetch players from DB for report:', err);
  }

  // Step 2: For any IDs not found in DB, fall back to PlayerSync (localStorage-based players)
  // These have IDs like "player-{timestamp}-{random}" and are stored in PlayerSync per club day
  const unresolvedIds = uniquePlayerIds.filter(pid => !playerNameMap.has(pid));
  if (unresolvedIds.length > 0) {
    log(`Report: ${unresolvedIds.length} player IDs not in DB, checking PlayerSync...`);
    try {
      const { data: syncEntries } = await getClient().models.PlayerSync.list({
        filter: { clubDayId: { eq: clubDayId } },
      });
      if (syncEntries && syncEntries.length > 0) {
        const syncData = (syncEntries[0] as any).playersJson;
        const syncedPlayers: any[] = syncData?.players || [];
        for (const p of syncedPlayers) {
          if (unresolvedIds.includes(p.id)) {
            const displayName = (p.nick && p.nick.trim()) || (p.name && p.name.trim()) || 'Unknown';
            playerNameMap.set(p.id, displayName);
          }
        }
      }
    } catch (err) {
      logError('Failed to fetch PlayerSync for report:', err);
    }

    // Step 3: Last resort — check localStorage directly for same-device sessions
    const stillUnresolved = uniquePlayerIds.filter(pid => !playerNameMap.has(pid));
    if (stillUnresolved.length > 0) {
      try {
        const syncKey = `players-sync-${clubDayId}`;
        const cached = localStorage.getItem(syncKey);
        if (cached) {
          const syncData = JSON.parse(cached);
          const cachedPlayers: any[] = syncData?.players || [];
          for (const p of cachedPlayers) {
            if (stillUnresolved.includes(p.id)) {
              const displayName = (p.nick && p.nick.trim()) || (p.name && p.name.trim()) || 'Unknown';
              playerNameMap.set(p.id, displayName);
            }
          }
        }
      } catch (err) {
        logError('Failed to read localStorage player cache for report:', err);
      }
    }
  }

  log(`Report: resolved ${playerNameMap.size}/${uniquePlayerIds.length} player names`);

  // Build named lists
  const checkedInNames = activeCheckIns
    .sort((a, b) => a.checkin_time.localeCompare(b.checkin_time))
    .map(ci => ({
      name: playerNameMap.get(ci.player_id) || 'Unknown',
      amount: ci.door_fee_amount,
      time: ci.checkin_time,
    }));

  const refundedNames = refundedCheckIns
    .sort((a, b) => (a.refunded_at || '').localeCompare(b.refunded_at || ''))
    .map(ci => {
      const refund = refundsData.find(r => r.checkin_id === ci.id);
      return {
        name: playerNameMap.get(ci.player_id) || 'Unknown',
        amount: refund?.amount || ci.door_fee_amount,
        reason: refund?.reason || '',
      };
    });

  // Door fees = sum of ALL check-ins (gross collected before refunds)
  const totalDoorFees = allCheckIns.reduce((sum: number, ci: CheckIn) => sum + ci.door_fee_amount, 0);
  const totalRefunds = refundsData.reduce((sum: number, refund: Refund) => sum + refund.amount, 0);
  const netTotal = totalDoorFees - totalRefunds;

  return {
    clubDay: toClubDay(clubDay.data),
    checkIns: allCheckIns,
    activeCheckIns,
    refunds: refundsData,
    checkedInNames,
    refundedNames,
    total_door_fees: totalDoorFees,
    total_refunds: totalRefunds,
    net_total: netTotal,
    checkin_count: allCheckIns.length,
    active_checkin_count: activeCheckIns.length,
    refund_count: refundsData.length,
  };
}

/**
 * End-of-Shift Report
 *
 * Returns buy-ins and refunds that occurred within the given time window,
 * scoped to the current active club day. Does NOT reset or close the day.
 *
 * @param shiftStart - ISO timestamp for shift start
 * @param shiftEnd   - ISO timestamp for shift end
 */
export async function getEndOfShiftReport(shiftStart: string, shiftEnd: string): Promise<any> {
  // Resolve active club day so we can scope to it
  const activeDay = await getActiveClubDay();
  const clubDayId = activeDay?.id;

  // Fetch all check-ins in the time window (include refunded ones for full picture)
  const checkInsResult = await getClient().models.CheckIn.list({
    filter: {
      and: [
        { checkinTime: { ge: shiftStart } },
        { checkinTime: { le: shiftEnd } },
        ...(clubDayId ? [{ clubDayId: { eq: clubDayId } }] : []),
      ],
    },
    limit: 1000,
  });
  const allCheckIns: CheckIn[] = (checkInsResult.data || []).map(toCheckIn);
  const activeCheckIns = allCheckIns.filter(ci => !ci.refunded_at);
  const refundedCheckIns = allCheckIns.filter(ci => !!ci.refunded_at);

  // Fetch refunds issued in the time window
  let refundsData: Refund[] = [];
  if (allCheckIns.length > 0) {
    const refundsResult = await getClient().models.Refund.list({
      filter: {
        and: [
          { createdAt: { ge: shiftStart } },
          { createdAt: { le: shiftEnd } },
          { checkinId: { in: allCheckIns.map(ci => ci.id) } },
        ],
      },
      limit: 1000,
    });
    refundsData = (refundsResult.data || []).map(toRefund);
  }

  // Resolve player names — same three-step approach as getClubDayReport
  const uniquePlayerIds = [...new Set(allCheckIns.map(ci => ci.player_id))];
  const playerNameMap = new Map<string, string>();

  try {
    const result = await getClient().models.Player.list({ limit: 1000 });
    for (const p of result.data || []) {
      const displayName = (p.nick && p.nick.trim()) || (p.name && p.name.trim()) || 'Unknown';
      playerNameMap.set(p.id, displayName);
    }
  } catch (err) {
    logError('Shift report: failed to fetch players from DB:', err);
  }

  if (clubDayId) {
    const unresolvedIds = uniquePlayerIds.filter(pid => !playerNameMap.has(pid));
    if (unresolvedIds.length > 0) {
      try {
        const { data: syncEntries } = await getClient().models.PlayerSync.list({
          filter: { clubDayId: { eq: clubDayId } },
        });
        if (syncEntries && syncEntries.length > 0) {
          const syncedPlayers: any[] = (syncEntries[0] as any).playersJson?.players || [];
          for (const p of syncedPlayers) {
            if (unresolvedIds.includes(p.id)) {
              playerNameMap.set(p.id, (p.nick && p.nick.trim()) || (p.name && p.name.trim()) || 'Unknown');
            }
          }
        }
      } catch (err) {
        logError('Shift report: failed to fetch PlayerSync:', err);
      }

      const stillUnresolved = uniquePlayerIds.filter(pid => !playerNameMap.has(pid));
      if (stillUnresolved.length > 0) {
        try {
          const cached = localStorage.getItem(`players-sync-${clubDayId}`);
          if (cached) {
            const cachedPlayers: any[] = JSON.parse(cached)?.players || [];
            for (const p of cachedPlayers) {
              if (stillUnresolved.includes(p.id)) {
                playerNameMap.set(p.id, (p.nick && p.nick.trim()) || (p.name && p.name.trim()) || 'Unknown');
              }
            }
          }
        } catch (err) {
          logError('Shift report: failed to read localStorage player cache:', err);
        }
      }
    }
  }

  const checkedInNames = activeCheckIns
    .sort((a, b) => a.checkin_time.localeCompare(b.checkin_time))
    .map(ci => ({
      name: playerNameMap.get(ci.player_id) || 'Unknown',
      amount: ci.door_fee_amount,
      time: ci.checkin_time,
    }));

  const refundedNames = refundedCheckIns
    .sort((a, b) => (a.refunded_at || '').localeCompare(b.refunded_at || ''))
    .map(ci => {
      const refund = refundsData.find(r => r.checkin_id === ci.id);
      return {
        name: playerNameMap.get(ci.player_id) || 'Unknown',
        amount: refund?.amount || ci.door_fee_amount,
        reason: refund?.reason || '',
      };
    });

  const totalDoorFees = allCheckIns.reduce((sum: number, ci: CheckIn) => sum + ci.door_fee_amount, 0);
  const totalRefunds = refundsData.reduce((sum: number, r: Refund) => sum + r.amount, 0);
  const netTotal = totalDoorFees - totalRefunds;

  return {
    shiftStart,
    shiftEnd,
    clubDayId,
    allCheckIns,
    activeCheckIns,
    refunds: refundsData,
    checkedInNames,
    refundedNames,
    total_door_fees: totalDoorFees,
    total_refunds: totalRefunds,
    net_total: netTotal,
    checkin_count: allCheckIns.length,
    active_checkin_count: activeCheckIns.length,
    refund_count: refundsData.length,
  };
}

// Cash Count functions
export async function createCashCount(
  scope: 'clubday' | 'shift',
  clubDayId: string | undefined,
  shiftStart: string | undefined,
  shiftEnd: string | undefined,
  countedAmount: number,
  adminUser: string
): Promise<CashCount> {
  const { data } = await getClient().models.CashCount.create({
    scope,
    clubDayId: clubDayId || undefined,
    shiftStart: shiftStart || undefined,
    shiftEnd: shiftEnd || undefined,
    countedAmount,
    countedAt: new Date().toISOString(),
    adminUser,
  });
  if (!data) throw new Error('Failed to create cash count');
  
  return {
    id: data.id,
    scope: data.scope || 'clubday',
    club_day_id: data.clubDayId || undefined,
    shift_start: data.shiftStart || undefined,
    shift_end: data.shiftEnd || undefined,
    counted_amount: data.countedAmount,
    counted_at: data.countedAt,
    admin_user: data.adminUser,
    created_at: data.createdAt || new Date().toISOString(),
  };
}

/**
 * Reset Day function - Production-Grade, Idempotent, and Safe for Concurrent Calls
 * 
 * RESET FLOW:
 * 1. Acquire distributed lock (prevents concurrent resets)
 * 2. Verify reset is still needed (idempotency check)
 * 3. Preserve buy-in limits from current tables
 * 4. Close current club day (mark as 'closed' with endedAt timestamp)
 * 5. Mark all seats as left (soft delete - preserves history)
 * 6. Mark all waitlist entries as removed (soft delete - preserves history)
 * 7. Close all tables (mark as 'CLOSED')
 * 8. Create new club day with default 3 tables
 * 9. Release lock
 * 
 * LEDGER SAFETY:
 * - Ledger entries are NEVER deleted or modified
 * - All entries reference club_day_id (business_day_id)
 * - Historical accuracy preserved forever
 * 
 * IDEMPOTENCY:
 * - Safe to call multiple times
 * - Checks current state before acting
 * - Uses distributed lock to prevent race conditions
 * 
 * FAILURE HANDLING:
 * - If reset fails partway through, lock expires after TTL
 * - Next reset attempt will complete the process
 * - No data loss - all operations are idempotent
 */
export async function resetClubDay(adminUser: string): Promise<void> {
  // Acquire distributed lock (prevents concurrent resets across tabs/nodes)
  const lockAcquired = acquireResetLock();
  if (!lockAcquired && adminUser === 'system-auto') {
    log('🔄 Reset already in progress (lock held) - skipping duplicate reset');
    return;
  }
  
  try {
    const activeClubDay = await getActiveClubDay();
    
    // If no active club day, just create a new one
    if (!activeClubDay) {
      log('🔄 No active club day - creating new business day');
      await createClubDay();
      return;
    }
    
    // Double-check: verify reset is still needed (idempotency)
    const resetCheck = shouldAutoReset(activeClubDay);
    if (!resetCheck.shouldReset && adminUser === 'system-auto') {
      log('🔄 Reset no longer needed - business day already current');
      return;
    }
    
    log(`🔄 Starting business day reset (triggered by: ${adminUser})`);
    log(`   Current day: ${activeClubDay.id} (started: ${activeClubDay.started_at})`);
    log(`   Reason: ${resetCheck.reason}`);
  
  // Preserve buy-in limits from current day's tables before closing
  const preservedBuyInLimits = new Map<number, string>();

  // Snapshot persistent tables + active waitlist players so they survive reset
  const persistentTableSnapshots: Array<{
    persistentTableId: string;
    tableNumber: number;
    gameType: PokerTable['game_type'];
    stakesText: string;
    seatsTotal: number;
    bombPotCount: number;
    buyInLimits?: string;
    showOnTv: boolean;
    publicSignups: boolean;
    waitlistPlayerIds: string[];
  }> = [];

  const persistentMeta = getPersistentTables();
  const persistentByApiId = new Map<string, PersistentTable>();
  const persistentByNumberNoApiId = new Map<number, PersistentTable>();
  for (const pt of persistentMeta) {
    if (pt.api_table_id) {
      persistentByApiId.set(pt.api_table_id, pt);
    } else {
      persistentByNumberNoApiId.set(pt.table_number, pt);
    }
  }

  // Get all tables before closing them to preserve buy-in limits and persistent state
  const tables = await getTablesForClubDay(activeClubDay.id);
  for (const table of tables) {
    if (table.buy_in_limits && table.buy_in_limits.trim()) {
      preservedBuyInLimits.set(table.table_number, table.buy_in_limits.trim());
      log(`💾 Preserving buy-in limits for Table ${table.table_number}: ${table.buy_in_limits}`);
    }

    const pt = persistentByApiId.get(table.id) || persistentByNumberNoApiId.get(table.table_number);
    if (!pt) continue;

    let activeWaitlist: TableWaitlist[] = [];
    try {
      activeWaitlist = await getWaitlistForTable(table.id, activeClubDay.id);
    } catch (error) {
      logWarn(`Could not snapshot waitlist for persistent table ${table.table_number}:`, error);
    }

    const orderedPlayerIds = [...activeWaitlist]
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((entry) => entry.player_id)
      .filter(Boolean);

    persistentTableSnapshots.push({
      persistentTableId: pt.id,
      tableNumber: pt.table_number || table.table_number,
      gameType: (pt.game_type || table.game_type) as PokerTable['game_type'],
      stakesText: pt.stakes_text || table.stakes_text || '',
      seatsTotal: pt.seats_total || table.seats_total || 20,
      bombPotCount: pt.bomb_pot_count || table.bomb_pot_count || 1,
      buyInLimits: pt.buy_in_limits || table.buy_in_limits,
      showOnTv: pt.show_on_tv ?? table.show_on_tv ?? true,
      publicSignups: pt.public_signups,
      waitlistPlayerIds: orderedPlayerIds,
    });
  }

  if (persistentTableSnapshots.length > 0) {
    log(`💾 Snapshotting ${persistentTableSnapshots.length} persistent table(s) for reset carryover`);
  }
  
  // Close current club day (idempotent - safe to call multiple times)
  try {
    await getClient().models.ClubDay.update({
      id: activeClubDay.id,
      status: 'closed',
      endedAt: new Date().toISOString(),
    });
    log(`✅ Closed club day ${activeClubDay.id}`);
  } catch (error) {
    // If already closed, that's fine (idempotent)
    logWarn('Club day may already be closed:', error);
  }
    
    // CRITICAL: Mark all seats as left for the current club day
    // This ensures tables are empty when a new club day starts
    log(`🔄 Marking all seats as left for club day ${activeClubDay.id}...`);
    const seats = await getClient().models.TableSeat.list({
      filter: {
        and: [
          { clubDayId: { eq: activeClubDay.id } },
          { leftAt: { attributeExists: false } },
        ],
      },
    });
    log(`🔄 Found ${seats.data?.length || 0} seats to mark as left`);
    for (const seat of seats.data || []) {
      try {
        await getClient().models.TableSeat.update({
          id: seat.id,
          leftAt: new Date().toISOString(),
        });
      } catch (error) {
        logError(`Failed to mark seat ${seat.id} as left:`, error);
      }
    }
    
    // CRITICAL: Mark all waitlist as removed for the current club day
    // This ensures waitlists are empty when a new club day starts
    log(`🔄 Marking all waitlist entries as removed for club day ${activeClubDay.id}...`);
    const waitlist = await getClient().models.TableWaitlist.list({
      filter: {
        and: [
          { clubDayId: { eq: activeClubDay.id } },
          { removedAt: { attributeExists: false } },
        ],
      },
    });
    log(`🔄 Found ${waitlist.data?.length || 0} waitlist entries to mark as removed`);
    for (const wl of waitlist.data || []) {
      try {
        await getClient().models.TableWaitlist.update({
          id: wl.id,
          removedAt: new Date().toISOString(),
        });
      } catch (error) {
        logError(`Failed to mark waitlist entry ${wl.id} as removed:`, error);
      }
    }
    
    // Close all tables (idempotent - safe if already closed)
    log(`🔄 Closing ${tables.length} tables...`);
    for (const table of tables) {
      try {
        await getClient().models.PokerTable.update({
          id: table.id,
          status: 'CLOSED',
          closedAt: new Date().toISOString(),
        });
      } catch (error) {
        logWarn(`Table ${table.id} may already be closed:`, error);
      }
    }
    
    // Create new club day (which will create default 3 tables with preserved buy-in limits)
    log(`🔄 Creating new business day...`);
    const newClubDay = await createClubDay(preservedBuyInLimits);

    // Recreate/rebind persistent tables on the new club day and restore waitlists
    if (persistentTableSnapshots.length > 0) {
      const newDayTables = await getTablesForClubDay(newClubDay.id);
      const availableByNumber = new Map<number, PokerTable[]>();
      for (const table of newDayTables) {
        const listForNumber = availableByNumber.get(table.table_number) || [];
        listForNumber.push(table);
        availableByNumber.set(table.table_number, listForNumber);
      }

      for (const snapshot of persistentTableSnapshots) {
        try {
          let targetTableId: string;
          const sameNumberTables = availableByNumber.get(snapshot.tableNumber);

          if (sameNumberTables && sameNumberTables.length > 0) {
            const reusedTable = sameNumberTables.shift()!;
            await getClient().models.PokerTable.update({
              id: reusedTable.id,
              gameType: snapshot.gameType,
              stakesText: snapshot.stakesText,
              seatsTotal: snapshot.seatsTotal,
              bombPotCount: snapshot.bombPotCount,
              buyInLimits: snapshot.buyInLimits || null,
              showOnTv: snapshot.showOnTv,
              status: 'OPEN',
            });
            targetTableId = reusedTable.id;
            log(`♻️ Reused Table ${snapshot.tableNumber} for persistent table carryover`);
          } else {
            const { data: recreatedTable } = await getClient().models.PokerTable.create({
              clubDayId: newClubDay.id,
              tableNumber: snapshot.tableNumber,
              gameType: snapshot.gameType,
              stakesText: snapshot.stakesText,
              seatsTotal: snapshot.seatsTotal,
              bombPotCount: snapshot.bombPotCount,
              buyInLimits: snapshot.buyInLimits || null,
              showOnTv: snapshot.showOnTv,
              status: 'OPEN',
            });
            if (!recreatedTable) throw new Error('Failed to recreate persistent table during reset');
            targetTableId = recreatedTable.id;
            log(`✅ Recreated persistent table ${snapshot.tableNumber} on new club day`);
          }

          updatePersistentTable(snapshot.persistentTableId, {
            api_table_id: targetTableId,
            table_number: snapshot.tableNumber,
            game_type: snapshot.gameType,
            stakes_text: snapshot.stakesText,
            seats_total: snapshot.seatsTotal,
            bomb_pot_count: snapshot.bombPotCount,
            buy_in_limits: snapshot.buyInLimits,
            show_on_tv: snapshot.showOnTv,
            public_signups: snapshot.publicSignups,
            status: 'OPEN',
            waitlist_count: snapshot.waitlistPlayerIds.length,
          });

          for (let index = 0; index < snapshot.waitlistPlayerIds.length; index++) {
            const playerId = snapshot.waitlistPlayerIds[index];
            try {
              await getClient().models.TableWaitlist.create({
                tableId: targetTableId,
                playerId,
                clubDayId: newClubDay.id,
                position: index + 1,
                addedAt: new Date().toISOString(),
                calledIn: false,
              });
            } catch (error) {
              logWarn(`Failed to restore waitlist player ${playerId} on Table ${snapshot.tableNumber}:`, error);
            }
          }
        } catch (error) {
          logError(`Failed to carry over persistent table ${snapshot.tableNumber}:`, error);
        }
      }

      log('✅ Persistent tables and waitlists carried over to new club day');
    }
    
    log(`✅ Business day reset complete:`);
    log(`   Closed day: ${activeClubDay.id}`);
    log(`   New day: ${newClubDay.id} (started: ${newClubDay.started_at})`);
    log(`   Preserved buy-in limits for ${preservedBuyInLimits.size} tables`);
    
    // IMPORTANT: Check-ins are scoped to clubDayId, so all check-ins from the previous day
    // are automatically tied to the old clubDayId. When checking if a player is already
    // checked in, getCheckInForPlayer() filters by the current clubDayId, so players
    // from previous days won't interfere with the new day.
    log(`✅ Ledger entries preserved - all entries reference club_day_id for historical accuracy`);
    
    // Verify data integrity after reset
    try {
      const integrityCheck = await verifyDataIntegrity();
      if (integrityCheck.status === 'error') {
        logError('🚨 Data integrity issues detected after reset:', integrityCheck.issues);
      } else if (integrityCheck.status === 'warning') {
        logWarn('⚠️ Data integrity warnings after reset:', integrityCheck.issues);
      } else {
        log('✅ Data integrity verified after reset');
      }
    } catch (error) {
      logWarn('Could not verify data integrity after reset:', error);
    }
    
  } catch (error) {
    logError('Error during business day reset:', error);
    throw error;
  } finally {
    // Always release lock, even if reset fails
    releaseResetLock();
  }
  
  // Clear recently busted out/removed players from localStorage
  // This ensures the "Recently Removed/Busted Out" panel disappears on day reset
  try {
    localStorage.removeItem('recent-bust-outs');
    localStorage.removeItem('recent-removals');
    log('🧹 Cleared recent bust-outs and removals from localStorage');
  } catch (error) {
    logWarn('Failed to clear recent bust-outs/removals from localStorage:', error);
  }
  
  // Log the action (only if adminUser is provided and not 'system')
  if (adminUser && adminUser !== 'system') {
    try {
      await getClient().models.AuditLog.create({
        adminUser,
        action: 'reset_club_day',
        entityType: 'ClubDay',
        reason: adminUser === 'system' ? 'Automatic 9:00am reset' : 'Manual reset day action',
      });
    } catch (error) {
      // Audit log creation is optional, don't fail if it fails
      logWarn('Failed to create audit log:', error);
    }
  }
}

/**
 * Full state restore after an accidental day reset.
 *
 * Recovers everything the reset touched within the last N minutes:
 *   1. Re-opens the original club day (if it was closed by the reset)
 *   2. Deletes the empty new club day that the reset created (and ALL its tables)
 *   3. Re-opens tables that were closed by the reset (including mid-session added tables)
 *   4. Restores TableSeat records (clears leftAt stamped by the reset)
 *   5. Restores TableWaitlist records (clears removedAt stamped by the reset)
 *   6. Deletes spurious Refund records created within the window and clears the
 *      associated CheckIn.refundedAt — preserving original doorFeeAmount intact
 *   7. Purges orphaned seat/waitlist entries whose player cannot be resolved (shows as "Unknown")
 *
 * Note: resetClubDay never modifies CheckIn.doorFeeAmount — buy-in amounts are
 * always preserved and do not need to be restored.
 *
 * @param adminUser    - Who is performing the recovery (for audit log)
 * @param windowMinutes - How far back to look (default 60 minutes)
 */
export async function recoverRecentlyRemovedPlayers(
  adminUser: string,
  windowMinutes = 60
): Promise<{
  seatsRestored: number;
  waitlistRestored: number;
  tablesReopened: number;
  checkInsRestored: number;
  orphansRemoved: number;
  newDayDeleted: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  let seatsRestored = 0;
  let waitlistRestored = 0;
  let tablesReopened = 0;
  let checkInsRestored = 0;
  let orphansRemoved = 0;
  let newDayDeleted = false;

  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  log(`🔄 Full state restore: looking for records modified after ${cutoff} (window: ${windowMinutes} min)`);

  // -------------------------------------------------------------------------
  // Step 1: Identify the target (original) club day and the empty new day
  //
  // Scenario A: accidental reset ran → old day closed, new empty day created
  //   activeDay = new empty day (created within window, has no check-ins)
  //   targetDay = most recently closed day (closed within window)
  //
  // Scenario B: no reset ran but something else removed players
  //   activeDay = the real day we want to restore
  //   targetDay = activeDay
  // -------------------------------------------------------------------------
  let targetClubDayId: string | null = null;
  let newDayIdToDelete: string | null = null;

  const activeDay = await getActiveClubDay();

  if (activeDay) {
    // Check if the active day was created within the recovery window (i.e. it's the new empty day)
    const activeDayCreatedAt = activeDay.started_at || '';
    const isNewEmptyDay = activeDayCreatedAt >= cutoff;

    if (isNewEmptyDay) {
      // The active day is the empty one created by the reset — find the real day
      newDayIdToDelete = activeDay.id;
      log(`🔄 Restore: active day ${activeDay.id} looks like the reset-created day (created ${activeDayCreatedAt})`);

      try {
        const { data: closedDays } = await getClient().models.ClubDay.list({
          filter: { status: { eq: 'closed' } },
        });
        if (closedDays && closedDays.length > 0) {
          const sorted = [...closedDays].sort((a, b) =>
            new Date(b.endedAt || b.createdAt || 0).getTime() -
            new Date(a.endedAt || a.createdAt || 0).getTime()
          );
          const candidate = sorted[0];
          const closedAt = candidate.endedAt || candidate.updatedAt || '';
          if (closedAt >= cutoff) {
            targetClubDayId = candidate.id;
            log(`🔄 Restore: original club day is ${targetClubDayId} (closed at ${closedAt})`);
          }
        }
      } catch (err) {
        const msg = `Failed to find original club day: ${err}`;
        logError(msg, err);
        errors.push(msg);
      }
    } else {
      // Active day is the real day — no new day was created, just restore in place
      targetClubDayId = activeDay.id;
      log(`🔄 Restore: using active club day ${targetClubDayId}`);
    }
  } else {
    // No active day at all — find the most recently closed one
    try {
      const { data: closedDays } = await getClient().models.ClubDay.list({
        filter: { status: { eq: 'closed' } },
      });
      if (closedDays && closedDays.length > 0) {
        const sorted = [...closedDays].sort((a, b) =>
          new Date(b.endedAt || b.createdAt || 0).getTime() -
          new Date(a.endedAt || a.createdAt || 0).getTime()
        );
        const candidate = sorted[0];
        const closedAt = candidate.endedAt || candidate.updatedAt || '';
        if (closedAt >= cutoff) {
          targetClubDayId = candidate.id;
          log(`🔄 Restore: using recently closed club day ${targetClubDayId}`);
        }
      }
    } catch (err) {
      const msg = `Failed to find recently closed club day: ${err}`;
      logError(msg, err);
      errors.push(msg);
    }
  }

  if (!targetClubDayId) {
    errors.push('No recoverable club day found within the time window — nothing to restore.');
    return { seatsRestored, waitlistRestored, tablesReopened, checkInsRestored, orphansRemoved, newDayDeleted, errors };
  }

  // -------------------------------------------------------------------------
  // Step 2: Re-open the original club day if it was closed by the reset
  // -------------------------------------------------------------------------
  try {
    const { data: dayData } = await getClient().models.ClubDay.get({ id: targetClubDayId });
    if (dayData && dayData.status === 'closed') {
      await getClient().models.ClubDay.update({
        id: targetClubDayId,
        status: 'active',
        endedAt: null as any,
      });
      log(`✅ Restore: re-opened club day ${targetClubDayId}`);
    }
  } catch (err) {
    const msg = `Failed to re-open club day ${targetClubDayId}: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // Step 3: Delete the empty new day (and its default tables) created by reset
  // -------------------------------------------------------------------------
  if (newDayIdToDelete) {
    try {
      // Delete default tables that were created with the new day
      const { data: newDayTables } = await getClient().models.PokerTable.list({
        filter: { clubDayId: { eq: newDayIdToDelete } },
        limit: 50,
      });
      for (const t of newDayTables || []) {
        try {
          await getClient().models.PokerTable.delete({ id: t.id });
          log(`🗑️ Restore: deleted new-day table ${t.id} (Table ${t.tableNumber})`);
        } catch (err) {
          logWarn(`Could not delete new-day table ${t.id}:`, err);
        }
      }
      // Delete the new day itself
      await getClient().models.ClubDay.delete({ id: newDayIdToDelete });
      newDayDeleted = true;
      log(`🗑️ Restore: deleted empty new club day ${newDayIdToDelete}`);
    } catch (err) {
      const msg = `Failed to delete new club day ${newDayIdToDelete}: ${err}`;
      logError(msg, err);
      errors.push(msg);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Re-open tables that were closed by the reset
  // -------------------------------------------------------------------------
  try {
    const { data: allTables } = await getClient().models.PokerTable.list({
      filter: { clubDayId: { eq: targetClubDayId } },
      limit: 200,
    });

    const tablesToReopen = (allTables || []).filter(
      (t: any) => t.status === 'CLOSED' && t.closedAt && t.closedAt >= cutoff
    );
    log(`🔄 Restore: found ${tablesToReopen.length} table(s) to re-open`);

    for (const table of tablesToReopen) {
      try {
        await getClient().models.PokerTable.update({
          id: table.id,
          status: 'OPEN',
          closedAt: null as any,
        });
        tablesReopened++;
      } catch (err) {
        const msg = `Failed to re-open table ${table.id}: ${err}`;
        logError(msg, err);
        errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `Failed to query tables for restore: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // Step 5: Restore TableSeat records (clear leftAt stamped by the reset)
  // -------------------------------------------------------------------------
  try {
    const { data: allSeats } = await getClient().models.TableSeat.list({
      filter: { clubDayId: { eq: targetClubDayId } },
      limit: 1000,
    });

    const seatsToRestore = (allSeats || []).filter(
      (s: any) => s.leftAt && s.leftAt >= cutoff
    );
    log(`🔄 Restore: found ${seatsToRestore.length} seat(s) to restore`);

    for (const seat of seatsToRestore) {
      try {
        await getClient().models.TableSeat.update({
          id: seat.id,
          leftAt: null as any,
        });
        seatsRestored++;
      } catch (err) {
        const msg = `Failed to restore seat ${seat.id}: ${err}`;
        logError(msg, err);
        errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `Failed to query seats for restore: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // Step 6: Restore TableWaitlist records (clear removedAt stamped by the reset)
  // -------------------------------------------------------------------------
  try {
    const { data: allWaitlist } = await getClient().models.TableWaitlist.list({
      filter: { clubDayId: { eq: targetClubDayId } },
      limit: 1000,
    });

    const waitlistToRestore = (allWaitlist || []).filter(
      (w: any) => w.removedAt && w.removedAt >= cutoff
    );
    log(`🔄 Restore: found ${waitlistToRestore.length} waitlist entry/entries to restore`);

    for (const wl of waitlistToRestore) {
      try {
        await getClient().models.TableWaitlist.update({
          id: wl.id,
          removedAt: null as any,
        });
        waitlistRestored++;
      } catch (err) {
        const msg = `Failed to restore waitlist entry ${wl.id}: ${err}`;
        logError(msg, err);
        errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `Failed to query waitlist for restore: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // Step 7: Delete spurious Refund records created within the recovery window
  // and clear the associated CheckIn.refundedAt so the check-in is active again.
  //
  // Note: resetClubDay itself does NOT create Refund records or modify
  // CheckIn.doorFeeAmount — buy-in amounts are always preserved.
  // This step handles the case where an operator accidentally issued refunds
  // during the window that should be reversed as part of the full restore.
  // -------------------------------------------------------------------------
  try {
    const { data: recentRefunds } = await getClient().models.Refund.list({
      filter: { createdAt: { ge: cutoff } },
      limit: 1000,
    });

    // Filter to refunds whose check-in belongs to the target club day
    const refundsToDelete = (recentRefunds || []).filter(
      (r: any) => r.createdAt && r.createdAt >= cutoff
    );

    // Resolve which check-ins belong to the target club day
    const checkinIds = [...new Set(refundsToDelete.map((r: any) => r.checkinId).filter(Boolean))];
    let targetCheckinIds = new Set<string>();
    if (checkinIds.length > 0) {
      try {
        const { data: checkInsForDay } = await getClient().models.CheckIn.list({
          filter: { clubDayId: { eq: targetClubDayId } },
          limit: 1000,
        });
        targetCheckinIds = new Set((checkInsForDay || []).map((ci: any) => ci.id));
      } catch (err) {
        logWarn('Could not fetch check-ins to scope refund restore:', err);
      }
    }

    const scopedRefunds = refundsToDelete.filter((r: any) => targetCheckinIds.has(r.checkinId));
    log(`🔄 Restore: found ${scopedRefunds.length} spurious refund(s) to delete`);

    for (const refund of scopedRefunds) {
      try {
        // Clear refundedAt on the associated check-in first
        if (refund.checkinId) {
          await getClient().models.CheckIn.update({
            id: refund.checkinId,
            refundedAt: null as any,
          });
          checkInsRestored++;
        }
        // Delete the spurious refund record
        await getClient().models.Refund.delete({ id: refund.id });
        // Also delete the refund receipt if present
        if (refund.refundReceiptId) {
          try {
            await getClient().models.Receipt.delete({ id: refund.refundReceiptId });
          } catch (_err) {
            // Receipt deletion is best-effort
          }
        }
        log(`🗑️ Restore: deleted spurious refund ${refund.id} and cleared check-in ${refund.checkinId}`);
      } catch (err) {
        const msg = `Failed to delete refund ${refund.id}: ${err}`;
        logError(msg, err);
        errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `Failed to query refunds for restore: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // Step 8: Purge orphaned seat/waitlist entries with no resolvable player
  // These show as "Unknown" in all views because the player record is missing.
  // We mark them as left/removed so they disappear from active views.
  // -------------------------------------------------------------------------
  try {
    // Fetch all currently active seats for this club day
    const { data: activeSeats } = await getClient().models.TableSeat.list({
      filter: {
        and: [
          { clubDayId: { eq: targetClubDayId } },
          { leftAt: { attributeExists: false } },
        ],
      },
      limit: 1000,
    });

    for (const seat of activeSeats || []) {
      // If playerId is missing or the player record doesn't exist, it will render as Unknown
      if (!seat.playerId) {
        try {
          await getClient().models.TableSeat.update({
            id: seat.id,
            leftAt: new Date().toISOString(),
          });
          orphansRemoved++;
          log(`🧹 Restore: removed orphaned seat ${seat.id} (no playerId)`);
        } catch (err) {
          logWarn(`Could not remove orphaned seat ${seat.id}:`, err);
        }
        continue;
      }
      // Try to resolve the player — if not found, mark as left
      try {
        const { data: playerData } = await getClient().models.Player.get({ id: seat.playerId });
        if (!playerData) {
          await getClient().models.TableSeat.update({
            id: seat.id,
            leftAt: new Date().toISOString(),
          });
          orphansRemoved++;
          log(`🧹 Restore: removed orphaned seat ${seat.id} (player ${seat.playerId} not found)`);
        }
      } catch (_err) {
        // Can't verify — leave it alone
      }
    }
  } catch (err) {
    const msg = `Failed to purge orphaned seats: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  try {
    const { data: activeWaitlist } = await getClient().models.TableWaitlist.list({
      filter: {
        and: [
          { clubDayId: { eq: targetClubDayId } },
          { removedAt: { attributeExists: false } },
        ],
      },
      limit: 1000,
    });

    for (const wl of activeWaitlist || []) {
      if (!wl.playerId) {
        try {
          await getClient().models.TableWaitlist.update({
            id: wl.id,
            removedAt: new Date().toISOString(),
          });
          orphansRemoved++;
          log(`🧹 Restore: removed orphaned waitlist entry ${wl.id} (no playerId)`);
        } catch (err) {
          logWarn(`Could not remove orphaned waitlist entry ${wl.id}:`, err);
        }
        continue;
      }
      try {
        const { data: playerData } = await getClient().models.Player.get({ id: wl.playerId });
        if (!playerData) {
          await getClient().models.TableWaitlist.update({
            id: wl.id,
            removedAt: new Date().toISOString(),
          });
          orphansRemoved++;
          log(`🧹 Restore: removed orphaned waitlist entry ${wl.id} (player ${wl.playerId} not found)`);
        }
      } catch (_err) {
        // Can't verify — leave it alone
      }
    }
  } catch (err) {
    const msg = `Failed to purge orphaned waitlist entries: ${err}`;
    logError(msg, err);
    errors.push(msg);
  }

  log(`✅ Full restore complete: ${seatsRestored} seats, ${waitlistRestored} waitlist, ${tablesReopened} tables, ${checkInsRestored} check-ins restored. ${orphansRemoved} orphans removed. New day deleted: ${newDayDeleted}. Errors: ${errors.length}`);

  try {
    await getClient().models.AuditLog.create({
      adminUser,
      action: 'recover_state',
      entityType: 'ClubDay',
      reason: `Full restore: ${seatsRestored} seats, ${waitlistRestored} waitlist, ${tablesReopened} tables, ${checkInsRestored} check-ins, ${orphansRemoved} orphans removed`,
    });
  } catch (_err) {
    // Audit log is optional
  }

  return { seatsRestored, waitlistRestored, tablesReopened, checkInsRestored, orphansRemoved, newDayDeleted, errors };
}
