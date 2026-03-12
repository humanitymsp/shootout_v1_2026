/**
 * ⚠️ PRODUCTION CODE - DO NOT MODIFY WITHOUT CAREFUL CONSIDERATION ⚠️
 * 
 * PublicPage.tsx - Public-facing mobile-optimized table display
 * 
 * This is a production-critical component that serves as the public-facing view
 * for displaying poker table information on mobile devices. It is accessed via
 * the /public route and is designed to be mobile-first, responsive, and optimized
 * for real-time updates.
 * 
 * CRITICAL FUNCTIONALITY:
 * - Real-time synchronization with admin updates via BroadcastChannel and localStorage
 * - Accurate player counting using centralized getTableCounts() function
 * - Club day filtering to prevent showing players from previous days
 * - Mobile-first responsive design with dark theme
 * - Automatic polling and event-driven refresh mechanisms
 * 
 * ⚠️ WARNING: Modifications to this file can break:
 * - Public-facing user experience
 * - Real-time update synchronization
 * - Player count accuracy
 * - Mobile responsiveness
 * - Cross-device data consistency
 * 
 * Before modifying:
 * 1. Understand the real-time update mechanisms (BroadcastChannel, localStorage polling)
 * 2. Verify changes don't break mobile-first responsive design
 * 3. Ensure clubDayId is always passed to getTableCounts() to prevent stale data
 * 4. Test on actual mobile devices, not just browser dev tools
 * 5. Verify real-time updates still work across multiple tabs/devices
 * 
 * Related Documentation:
 * - docs/TABLET_AND_PUBLIC_ROUTES.md - Route architecture and usage
 * - docs/PAGINATION_CRITICAL_FIX.md - Player counting and pagination details
 * 
 * Last Production Review: [Current Date]
 * Status: PRODUCTION STABLE - DO NOT MODIFY WITHOUT APPROVAL
 */

import { useEffect, useState, useRef } from 'react';
import { getActiveClubDay, getTablesForClubDay, getAllPlayers, getCheckInForPlayer } from '../lib/api';
import { getTableCounts } from '../lib/tableCounts';
import { generateClient } from '../lib/graphql-client';
import { initializeLocalPlayers, startPlayerSyncPolling, getPlayerByIdLocal } from '../lib/localStoragePlayers';
import { getPersistentTables, getTableWaitlist as getPersistentWaitlistForTable } from '../lib/persistentTables';
import { createPendingSignup } from '../lib/pendingSignups';
import { validatePhoneNumber } from '../lib/sms';
import { log, logWarn, logError } from '../lib/logger';
import { getHighHand, isHighHandEnabled, getRemainingTimeMs, getHighHandWinners } from '../lib/highHand';
import type { HighHand, HighHandWinner } from '../lib/highHand';
import type { ClubDay, PokerTable, TableSeat, TableWaitlist } from '../types';
import Logo from '../components/Logo';
import PlayingCard from '../components/PlayingCard';
import './PublicPage.css';
import '../components/HighHandBanner.css';

const client = generateClient();

interface TableDisplay {
  table: PokerTable;
  seatsFilled: number;
  waitlistCount: number;
  playersWaitingElsewhere: number;
  seatedPlayers: TableSeat[];
  waitlistPlayers: TableWaitlist[];
}

export default function PublicPage() {
  const [clubDay, setClubDay] = useState<ClubDay | null>(null);
  const [tableDisplays, setTableDisplays] = useState<TableDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const isLoadingRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);

  // Public signup state (for pre-sign up tables)
  const [signupTableId, setSignupTableId] = useState<string | null>(null);
  const [signupName, setSignupName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [highHand, setHighHand] = useState<HighHand | null>(getHighHand());
  const [highHandEnabled, setHighHandEnabled] = useState(isHighHandEnabled());
  const [highHandRemaining, setHighHandRemaining] = useState(getRemainingTimeMs());
  const [recentWinner, setRecentWinner] = useState<HighHandWinner | null>(null);


  useEffect(() => {
    // Initialize localStorage players system
    initializeLocalPlayers();
    loadData();
  }, []);

  useEffect(() => {
    if (!clubDay) return;

    // Player synchronization from admin device
    const stopPlayerSync = startPlayerSyncPolling(clubDay.id, (players) => {
      log(`📡 Public: Synced ${players.length} players from admin`);
    }, 10000, 'apiKey'); // Poll every 10 seconds with apiKey auth for public access

    // Data refresh polling for table updates
    const pollInterval = setInterval(() => {
      if (document.hidden) return;
      loadData();
    }, 10000); // 10s polling — event-driven updates handle instant changes

    return () => {
      clearInterval(pollInterval);
      stopPlayerSync();
    };
  }, [clubDay]);

  useEffect(() => {
    // Update clock every second + high hand countdown
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
      if (highHandEnabled) {
        setHighHandRemaining(getRemainingTimeMs());
      }
    }, 1000);

    return () => clearInterval(clockInterval);
  }, [highHandEnabled]);

  // Listen for high hand updates
  useEffect(() => {
    const handleHHUpdate = (e: StorageEvent) => {
      if (e.key === 'high-hand-updated') {
        const hand = getHighHand();
        const nowEnabled = isHighHandEnabled();
        if (highHand && !hand && nowEnabled) {
          const winners = getHighHandWinners();
          if (winners.length > 0) {
            setRecentWinner(winners[0]);
            setTimeout(() => setRecentWinner(null), 30000);
          }
        }
        setHighHandEnabled(nowEnabled);
        setHighHand(hand);
        if (hand) setHighHandRemaining(getRemainingTimeMs());
      }
    };
    window.addEventListener('storage', handleHHUpdate);

    let lastHHUpdate = localStorage.getItem('high-hand-updated');
    const pollHH = setInterval(() => {
      const current = localStorage.getItem('high-hand-updated');
      if (current !== lastHHUpdate) {
        lastHHUpdate = current;
        const hand = getHighHand();
        const nowEnabled = isHighHandEnabled();
        if (highHand && !hand && nowEnabled) {
          const winners = getHighHandWinners();
          if (winners.length > 0) {
            setRecentWinner(winners[0]);
            setTimeout(() => setRecentWinner(null), 30000);
          }
        }
        setHighHandEnabled(nowEnabled);
        setHighHand(hand);
        if (hand) setHighHandRemaining(getRemainingTimeMs());
      }
    }, 500);

    return () => {
      window.removeEventListener('storage', handleHHUpdate);
      clearInterval(pollHH);
    };
  }, [highHand, highHandEnabled]);

  useEffect(() => {
    // ⚠️ CRITICAL: Multi-channel real-time update system
    // This effect implements three synchronization mechanisms:
    // 1. StorageEvent listener (cross-tab updates)
    // 2. localStorage polling (same-tab updates)
    // 3. BroadcastChannel (same-origin real-time messaging)
    // 
    // DO NOT modify without understanding all three mechanisms and their interactions
    // Removing or changing any of these will break real-time updates for public users

    // Listen for instant refresh signals from admin (cross-tab updates)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'tv-updated' || e.key === 'table-updated' || e.key === 'player-updated') {
        debouncedRefresh();
      }
    };
    
    // Poll for localStorage changes (same-tab changes don't trigger storage events)
    let lastProcessedUpdate: string | null = null;
    const pollInterval = setInterval(() => {
      const lastTableUpdate = localStorage.getItem('table-updated');
      const lastTvUpdate = localStorage.getItem('tv-updated');
      const lastPlayerUpdate = localStorage.getItem('player-updated');
      
      const latestUpdate = lastTableUpdate || lastTvUpdate || lastPlayerUpdate;
      if (latestUpdate && latestUpdate !== lastProcessedUpdate) {
        const updateTime = new Date(latestUpdate).getTime();
        const now = Date.now();
        if (now - updateTime < 10000) {
          lastProcessedUpdate = latestUpdate;
          debouncedRefresh();
        }
      }
    }, 3000); // 3s — main polling handles periodic updates

    // BroadcastChannel for same-origin real-time messaging
    let adminChannel: BroadcastChannel | null = null;
    let tvChannel: BroadcastChannel | null = null;
    let publicChannel: BroadcastChannel | null = null;

    try {
      adminChannel = new BroadcastChannel('admin-updates');
      adminChannel.addEventListener('message', (event) => {
        if (event.data?.type === 'player-update' || event.data?.type === 'table-update') {
          debouncedRefresh();
        }
      });
    } catch (error) {
      logWarn('Admin BroadcastChannel not available:', error);
    }

    try {
      tvChannel = new BroadcastChannel('tv-updates');
      tvChannel.addEventListener('message', () => {
        debouncedRefresh();
      });
    } catch (error) {
      logWarn('TV BroadcastChannel not available:', error);
    }

    try {
      publicChannel = new BroadcastChannel('public-updates');
      publicChannel.addEventListener('message', (event) => {
        if (event.data?.type === 'public-toggle') {
          debouncedRefresh();
        }
      });
    } catch (error) {
      logWarn('Public BroadcastChannel not available:', error);
    }

    window.addEventListener('storage', handleStorage);

    return () => {
      // ⚠️ CRITICAL: Cleanup all listeners and channels to prevent memory leaks
      if (adminChannel) {
        adminChannel.close();
      }
      if (tvChannel) {
        tvChannel.close();
      }
      if (publicChannel) {
        publicChannel.close();
      }
      window.removeEventListener('storage', handleStorage);
      clearInterval(pollInterval);
    };
  }, []);

  /**
   * ⚠️ CRITICAL: Main data loading function
   * 
   * This function is called by multiple update mechanisms:
   * - Initial page load
   * - Polling intervals (every 2 seconds)
   * - StorageEvent listeners
   * - BroadcastChannel messages
   * 
   * DO NOT modify without understanding:
   * 1. The clubDayId filtering is CRITICAL - prevents showing players from old club days
   * 2. getTableCounts() is the SINGLE SOURCE OF TRUTH for player counts
   * 3. Table deduplication by table_number prevents duplicate displays
   * 4. Sorting by table_number ensures consistent display order
   * 
   * Performance considerations:
   * - This function runs frequently (every 2 seconds + event-driven)
   * - Each table requires an async call to getTableCounts()
   * - Modifications that add database calls will impact performance
   */
  // Debounced refresh — coalesces rapid-fire events into one loadData call
  const debouncedRefresh = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      loadData();
    }, 500);
  };

  const loadData = async () => {
    // Concurrency guard - skip if already loading
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      // Use apiKey auth so the public page works without login
      const AUTH = 'apiKey';

      // Get active club day
      const activeDay = await getActiveClubDay(AUTH);
      if (!activeDay) {
        setLoading(false);
        return;
      }
      setClubDay(activeDay);

      // Build a player lookup map from PlayerSync (apiKey-accessible).
      // Player model doesn't allow apiKey reads, so GraphQL nested player { ... }
      // fields are skipped. We fetch player data separately from PlayerSync.
      const playerMap = new Map<string, { name: string; nick: string }>();
      try {
        const { data: syncEntries } = await client.models.PlayerSync.list({
          filter: { clubDayId: { eq: activeDay.id } },
          authMode: AUTH,
        });
        if (syncEntries && syncEntries.length > 0) {
          let raw = syncEntries[0].playersJson as any;
          if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch { raw = null; }
          }
          const arr: any[] = Array.isArray(raw) ? raw : (raw?.players || []);
          for (const p of arr) {
            if (p && p.id) {
              playerMap.set(p.id, { name: p.name || '', nick: p.nick || '' });
            }
          }
        }
        log(`Public: Loaded ${playerMap.size} players from PlayerSync`);
      } catch {
        log('Public: PlayerSync fetch failed — player names may show as Unknown');
      }

      // Helper: patch player data onto seat/waitlist entries using the playerMap
      // Always prefer PlayerSync data — enrichArrayWithPlayerData may return empty player objects
      // Falls back to localStorage cache, then assigns "Player N" placeholders
      let unknownCounter = 0;
      const patchPlayerData = <T extends { player_id: string; player?: any }>(items: T[]): T[] => {
        return items.map(item => {
          // 1st priority: PlayerSync data (most reliable for public page)
          const p = playerMap.get(item.player_id);
          if (p && (p.nick || p.name)) {
            return { ...item, player: { id: item.player_id, name: p.name, nick: p.nick } };
          }
          // 2nd priority: existing player data from enrichment
          if (item.player?.nick || item.player?.name) return item;
          // 3rd priority: localStorage cache (populated by startPlayerSyncPolling)
          const local = getPlayerByIdLocal(item.player_id);
          if (local && (local.nick || local.name)) {
            return { ...item, player: local };
          }
          // Fallback: assign a numbered placeholder
          unknownCounter++;
          const placeholder = `Player ${unknownCounter}`;
          return { ...item, player: { id: item.player_id, name: placeholder, nick: placeholder } };
        });
      };

      // ⚠️ CRITICAL: Get all tables and deduplicate by table_number
      // Multiple tables with same table_number can exist (different statuses)
      // Deduplication ensures only one table per number is displayed
      const allTables = await getTablesForClubDay(activeDay.id, AUTH);
      log('Public: All tables fetched:', allTables.map(t => `Table ${t.table_number} (${t.status})`));

      const dedupedTables = Array.from(
        new Map(allTables.map((table) => [table.table_number, table])).values()
      );

      // Patch is_persistent flag from localStorage persistent metadata
      const pts = getPersistentTables();
      const ptIds = new Set(pts.filter(pt => pt.api_table_id).map(pt => pt.api_table_id));
      const ptNumsNoId = new Set(pts.filter(pt => !pt.api_table_id).map(pt => pt.table_number));
      dedupedTables.forEach(t => {
        if (ptIds.has(t.id) || ptNumsNoId.has(t.table_number)) t.is_persistent = true;
      });

      // Filter out tables hidden from public page by admin
      let hiddenFromPublic: string[] = [];
      try {
        hiddenFromPublic = JSON.parse(localStorage.getItem('hidden-from-public') || '[]');
      } catch {}
      const tables = dedupedTables.filter(t => !hiddenFromPublic.includes(t.id));
      
      // Also filter out persistent tables with public_signups (they go to pre-sign up section)
      const persistentTablesWithSignups = pts.filter(pt => pt.public_signups && pt.api_table_id);
      const tablesWithoutPublicSignups = tables.filter(t => !persistentTablesWithSignups.some(pt => pt.api_table_id === t.id));
      log('Public: Visible tables:', tablesWithoutPublicSignups.map(t => `Table ${t.table_number} (${t.status})`));

      const displays: TableDisplay[] = [];

      for (const table of tablesWithoutPublicSignups) {
        // ⚠️ CRITICAL: Use centralized counting function - SINGLE SOURCE OF TRUTH
        // This ensures counts match Admin, TV, and Tablet views
        // CRITICAL: Pass clubDayId to prevent counting players from old club days
        // Removing this parameter will cause "Unknown" players to appear after day reset
        const counts = await getTableCounts(table.id, activeDay.id, AUTH);
        const seatsFilled = counts.seatedCount;
        const waitlistCount = counts.waitlistCount;

        // Patch player names from PlayerSync data
        const seatedPlayers = patchPlayerData(counts.seatedPlayers);
        const waitlistPlayers = patchPlayerData(counts.waitlistPlayers);

        // Count players seated here who are waiting at another table
        // This provides visibility into cross-table waitlist situations
        let playersWaitingElsewhere = 0;
        for (const seat of counts.seatedPlayers) {
          const { data: otherWaitlists } = await client.models.TableWaitlist.list({
            filter: {
              playerId: { eq: seat.player_id },
              removedAt: { attributeExists: false },
            },
            authMode: AUTH,
          });
          if (otherWaitlists && otherWaitlists.some((wl: { tableId: string }) => wl.tableId !== table.id)) {
            playersWaitingElsewhere++;
          }
        }

        displays.push({
          table,
          seatsFilled,
          waitlistCount,
          playersWaitingElsewhere,
          seatedPlayers,
          waitlistPlayers,
        });
      }

      // Add pre-sign up persistent tables from localStorage
      // Show persistent tables that have public_signups enabled and are not CLOSED.
      // Filter out stale entries: if a persistent table has an api_table_id that no longer
      // exists in the API AND doesn't have public_signups, it's a ghost game.
      const validApiTableIds = new Set(allTables.map(t => t.id));
      const persistentOnly = pts.filter(pt => {
        if (pt.status === 'CLOSED') return false;
        // Always show tables with public_signups enabled
        if (pt.public_signups) return true;
        // Tables without api_table_id are pure pre-signup — show them
        if (!pt.api_table_id) return true;
        // Tables with api_table_id but no public_signups — only show if the API table still exists
        return validApiTableIds.has(pt.api_table_id);
      });
      log(`Public: All persistent tables: ${pts.map(pt => `T${pt.table_number} (id=${pt.id.slice(0,8)}, api=${pt.api_table_id?.slice(0,8) || 'none'}, signups=${pt.public_signups}, status=${pt.status})`).join(', ')}`);
      log(`Public: Filtered persistent for display: ${persistentOnly.map(pt => `T${pt.table_number}`).join(', ') || '(none)'}`);
      for (const pt of persistentOnly) {
        const wl = getPersistentWaitlistForTable(pt.id);
        const syntheticTable: PokerTable = {
          id: pt.id,
          club_day_id: activeDay.id,
          table_number: pt.table_number,
          game_type: pt.game_type,
          stakes_text: pt.stakes_text,
          seats_total: pt.seats_total,
          bomb_pot_count: pt.bomb_pot_count,
          lockout_count: pt.lockout_count || 0,
          buy_in_limits: pt.buy_in_limits || '',
          status: pt.status || 'OPEN',
          created_at: pt.created_at,
          is_persistent: true,
        };
        const syntheticWaitlist: TableWaitlist[] = wl.map(w => ({
          id: w.id,
          club_day_id: activeDay.id,
          table_id: pt.id,
          player_id: w.id,
          position: w.position,
          added_at: w.added_at,
          created_at: w.created_at,
          player: { id: w.id, name: w.player_name, nick: w.player_name, created_at: w.created_at, updated_at: w.created_at },
        }));
        displays.push({
          table: syntheticTable,
          seatsFilled: 0,
          waitlistCount: wl.length,
          playersWaitingElsewhere: 0,
          seatedPlayers: [],
          waitlistPlayers: syntheticWaitlist,
        });
      }

      // ⚠️ CRITICAL: Sort by table number for consistent display order
      // Users expect tables to appear in numerical order
      displays.sort((a, b) => a.table.table_number - b.table.table_number);

      log('Public: Final displays:', displays.map(d => `Table ${d.table.table_number}`));

      setTableDisplays(displays);
    } catch (error) {
      logError('Error loading public page data:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="public-page">
        <div className="mobile-tv-loading">
          <div className="mobile-tv-spinner"></div>
          <h3>Loading Tables...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <div className="mobile-tv-header">
        <div className="mobile-tv-logo">
          <Logo />
        </div>
        <div className="mobile-tv-date-time">
          <div className="mobile-tv-date">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div className="mobile-tv-time">
            {currentTime.getHours() % 12 || 12}:{currentTime.getMinutes().toString().padStart(2, '0')}
            <span className="mobile-tv-seconds">:{currentTime.getSeconds().toString().padStart(2, '0')}</span>
          </div>
        </div>
      </div>

      <div className="mobile-tv-content">
        {(() => {
          const regularDisplays = tableDisplays.filter(d => !d.table.is_persistent);
          const persistentDisplays = tableDisplays.filter(d => d.table.is_persistent);

          return (
            <>
              {/* Active Games grouped by game type / stakes */}
              {regularDisplays.length === 0 && persistentDisplays.length === 0 ? (
                <div className="mobile-tv-empty">
                  <h3>No Active Games</h3>
                  <p>Check back later!</p>
                </div>
              ) : regularDisplays.length > 0 ? (() => {
                // Group tables by game type + stakes
                const grouped = new Map<string, { gameType: string; stakes: string; displays: TableDisplay[] }>();
                regularDisplays.forEach(display => {
                  const gameType = display.table.game_type || 'Other';
                  const stakes = (display.table.stakes_text || '').trim();
                  const groupKey = `${gameType}||${stakes}`;
                  if (!grouped.has(groupKey)) grouped.set(groupKey, { gameType, stakes, displays: [] });
                  grouped.get(groupKey)!.displays.push(display);
                });

                // Sort groups: 1/2 stakes first, then by game type priority
                const gameTypeOrder: Record<string, number> = {
                  'NLH': 1, 'PLO': 2, 'BigO': 3, 'PLO5': 4, 'Limit': 5, 'Mixed': 6, 'Other': 99
                };
                const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
                  // Prioritize 1/2 stakes first
                  const aIs12 = a.stakes.includes('1/2');
                  const bIs12 = b.stakes.includes('1/2');
                  if (aIs12 && !bIs12) return -1;
                  if (!aIs12 && bIs12) return 1;
                  const orderA = gameTypeOrder[a.gameType] || 50;
                  const orderB = gameTypeOrder[b.gameType] || 50;
                  if (orderA !== orderB) return orderA - orderB;
                  return a.stakes.localeCompare(b.stakes);
                });

                // Build global sets for TC detection
                const allSeatedPlayerIds = new Set<string>();
                const allWaitlistedPlayerIds = new Set<string>();
                for (const group of sortedGroups) {
                  for (const d of group.displays) {
                    for (const seat of d.seatedPlayers) {
                      allSeatedPlayerIds.add(seat.player_id);
                    }
                    for (const wl of d.waitlistPlayers) {
                      allWaitlistedPlayerIds.add(wl.player_id);
                    }
                  }
                }

                return sortedGroups.map(({ gameType, stakes, displays }) => {
                  const headerLabel = stakes ? `${gameType} — ${stakes}` : gameType;

                  // Collect all waitlist players, sort by added_at for consistent ordering across all merged views
                  const allWaitlistEntries: typeof displays[0]['waitlistPlayers'] = [];
                  displays.forEach(d => {
                    d.waitlistPlayers.forEach(wl => allWaitlistEntries.push(wl));
                  });
                  // Sort: regular players first (by added_at), TC players at the bottom (by added_at)
                  allWaitlistEntries.sort((a, b) => {
                    const aIsTC = allSeatedPlayerIds.has(a.player_id);
                    const bIsTC = allSeatedPlayerIds.has(b.player_id);
                    
                    // TC players go to the bottom
                    if (aIsTC && !bIsTC) return 1;
                    if (!aIsTC && bIsTC) return -1;
                    
                    // Within same group, sort by added_at (oldest first)
                    return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
                  });
                  const groupWaitlist: { id: string; name: string; playerId: string }[] = [];
                  const seenPlayerIds = new Set<string>();
                  allWaitlistEntries.forEach(wl => {
                    if (!seenPlayerIds.has(wl.player_id)) {
                      seenPlayerIds.add(wl.player_id);
                      groupWaitlist.push({
                        id: wl.id,
                        name: wl.player?.nick || wl.player?.name || 'Player',
                        playerId: wl.player_id,
                      });
                    }
                  });

                  const buyInLimits = displays.find(d => d.table.buy_in_limits)?.table.buy_in_limits || '';

                  return (
                    <div key={`${gameType}||${stakes}`} className="public-game-group">
                      <div className="public-game-group-header">
                        {headerLabel}
                        {buyInLimits && (
                          <span className="public-game-group-buyin">Buy-in: {buyInLimits}</span>
                        )}
                      </div>
                      {/* Table info summary */}
                      <div className="public-group-table-summary">
                        {displays.map((d) => {
                          // Count seated players at this table who are also on a waitlist (TC players)
                          const tcCount = d.seatedPlayers.filter(s => allWaitlistedPlayerIds.has(s.player_id)).length;
                          return (
                            <div key={d.table.id} className="public-summary-table-row">
                              <span className="public-summary-table-num">Table {d.table.table_number}</span>
                              <span className="public-summary-table-seats">
                                {d.seatsFilled} Seats
                                {tcCount > 0 && <span className="public-tc-badge public-tc-seated-badge">TC {tcCount}</span>}
                              </span>
                              {(d.table.bomb_pot_count || 0) > 0 && (
                                <span className="public-summary-bomb">💣 {d.table.bomb_pot_count} BP</span>
                              )}
                              {(d.table.lockout_count || 0) > 0 && (
                                <span className="public-summary-lockout">🔒 {d.table.lockout_count} LO</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {groupWaitlist.length > 0 && (
                        <div className="public-group-waitlist-summary">
                          <div className="public-group-waitlist-label">
                            Waitlist <span className="public-group-waitlist-count">{groupWaitlist.length}</span>
                          </div>
                          <div className="public-group-waitlist-names">
                            {(() => {
                              const cols: { id: string; name: string; playerId: string }[][] = [];
                              for (let i = 0; i < groupWaitlist.length; i += 10) {
                                cols.push(groupWaitlist.slice(i, i + 10));
                              }
                              return cols.map((col, ci) => (
                                <div key={ci} className="public-waitlist-col">
                                  {col.map((p) => (
                                    <span key={p.id} className="public-group-waitlist-name">
                                      {p.name}
                                    </span>
                                  ))}
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })() : null}

              {/* Pre-Sign Up Games (below active) — uses real API data */}
              {persistentDisplays.length > 0 && (
                <>
                  <div className="mobile-tv-section-label">Pre-Sign Up Games</div>
                  <div className="mobile-tv-grid">
                    {persistentDisplays.map((display) => {
                      const { table, seatsFilled, waitlistPlayers } = display;
                      const isSigningUp = signupTableId === table.id;
                      const gameLabel = table.game_type === 'NLH' ? 'NL' : table.game_type === 'BigO' ? 'Big O' : table.game_type;
                      const buyInRange = (table.buy_in_limits && table.buy_in_limits.trim()) ? table.buy_in_limits.trim() : '';
                      const bombPotCount = table.bomb_pot_count || 0;
                      const lockoutCount = table.lockout_count || 0;

                      return (
                        <div key={table.id} className="mobile-tv-card open">
                          <div className="mobile-tv-card-header">
                            <div className="mobile-tv-table-info">
                              <h3>Table {table.table_number}</h3>
                              <div className="mobile-tv-game-type">{gameLabel} • {(table.stakes_text || '').replace(/No Limit/gi, 'NL')}</div>
                            </div>
                            <div className="mobile-tv-status-badge">
                              <span className="status-dot open"></span>
                              Sign-Up
                            </div>
                          </div>

                          {buyInRange ? (
                            <div className="mobile-tv-buyin">Buy-in {buyInRange}</div>
                          ) : (
                            <div className="mobile-tv-buyin mobile-tv-buyin-muted">Buy-in See Floor</div>
                          )}

                          <div className="public-player-lists">
                            <div className="public-seated-count">
                              <span className="public-seated-count-number">{seatsFilled}</span>
                              <span className="public-seated-count-label">Seated</span>
                            </div>

                            <div className="public-player-section public-waitlist-section">
                              <div className="public-section-header">
                                <span className="public-section-title">Waitlist</span>
                              </div>
                              <ul className="public-player-names">
                                {waitlistPlayers.length > 0 ? (
                                  waitlistPlayers.map((wl) => (
                                    <li key={wl.id} className="public-player-name public-waiting-player">
                                      {wl.player?.nick || wl.player?.name || 'Player'}
                                    </li>
                                  ))
                                ) : (
                                  <li className="public-no-players">No one waiting</li>
                                )}
                              </ul>
                            </div>
                          </div>

                          {(bombPotCount > 0 || lockoutCount > 0) && (
                            <div className="mobile-tv-game-features">
                              {bombPotCount > 0 && (
                                <span className="mobile-tv-bomb-pots">
                                  💣 {bombPotCount} Bomb Pot{bombPotCount !== 1 ? 's' : ''}
                                </span>
                              )}
                              {lockoutCount > 0 && (
                                <span className="mobile-tv-lockouts">
                                  🔒 {lockoutCount} Lockout{lockoutCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          )}

                          {!isSigningUp ? (
                            <button
                              className="public-signup-btn"
                              onClick={() => { setSignupTableId(table.id); setSignupError(''); setSignupSuccess(''); }}
                            >
                              + Join Waitlist
                            </button>
                          ) : (
                            <form
                              className="public-signup-form"
                              onSubmit={async (e) => {
                                e.preventDefault();
                                setSignupError('');
                                const trimmedName = signupName.trim();
                                const trimmedPhone = signupPhone.trim();
                                const normalizedName = trimmedName.toLowerCase();
                                const normalizedPhone = trimmedPhone.replace(/\D/g, '');
                                if (!trimmedName || !trimmedPhone) {
                                  setSignupError('Name and phone number are required.');
                                  return;
                                }
                                if (!validatePhoneNumber(trimmedPhone)) {
                                  setSignupError('Please enter a valid US phone number.');
                                  return;
                                }
                                if (!clubDay) {
                                  setSignupError('No active club day found.');
                                  return;
                                }

                                // Guard: block duplicate public signups for players already active on seat/waitlist
                                const activePlayers = tableDisplays.flatMap(display => [
                                  ...display.seatedPlayers.map(seat => seat.player).filter(Boolean),
                                  ...display.waitlistPlayers.map(wl => wl.player).filter(Boolean),
                                ]);

                                const alreadyActive = activePlayers.some((player) => {
                                  const playerName = (player?.nick || player?.name || '').toLowerCase();
                                  const playerPhone = (player?.phone || '').replace(/\D/g, '');
                                  return playerName === normalizedName || (!!playerPhone && playerPhone === normalizedPhone);
                                });

                                if (alreadyActive) {
                                  setSignupError('You are already on the list. Please check with the front counter.');
                                  return;
                                }

                                setSignupLoading(true);
                                try {
                                  // Guard: best-effort duplicate check (may fail for unauthenticated users
                                  // since Player/CheckIn models require userPool auth — that's OK, admin
                                  // will catch duplicates when confirming the pending signup)
                                  try {
                                    const players = await getAllPlayers();
                                    const matchingPlayers = players.filter((player) => {
                                      const playerName = (player.nick || player.name || '').toLowerCase();
                                      const playerPhone = (player.phone || '').replace(/\D/g, '');
                                      return playerName === normalizedName || (!!playerPhone && playerPhone === normalizedPhone);
                                    });

                                    if (matchingPlayers.length > 0) {
                                      const checkIns = await Promise.all(
                                        matchingPlayers.map((player) =>
                                          getCheckInForPlayer(player.id, clubDay.id).catch(() => null)
                                        )
                                      );

                                      if (checkIns.some(Boolean)) {
                                        setSignupError('You are already on the list. Please check with the front counter.');
                                        return;
                                      }
                                    }
                                  } catch {
                                    // Unauthenticated — skip server-side duplicate check
                                  }

                                  const gameLabel = table.game_type === 'NLH' ? 'No Limit Hold\'em' : table.game_type === 'BigO' ? 'Big O' : table.game_type;
                                  const pending = await createPendingSignup({
                                    tableId: table.id,
                                    tableNumber: table.table_number,
                                    clubDayId: clubDay.id,
                                    playerName: trimmedName,
                                    playerPhone: trimmedPhone,
                                    gameType: gameLabel,
                                    stakesText: table.stakes_text || '',
                                  });
                                  log('[PublicPage] Pending signup created for admin approval:', pending.token.slice(0, 8));
                                  setSignupSuccess('You have been added to the list. Pending club confirmation.');
                                  setSignupName('');
                                  setSignupPhone('');
                                  setSignupTableId(null);
                                } catch (err: any) {
                                  logError('Public signup error:', err);
                                  setSignupError(err.message || 'Something went wrong. Please try again.');
                                } finally {
                                  setSignupLoading(false);
                                }
                              }}
                            >
                              <h4>Join Waitlist — Table {table.table_number}</h4>
                              <input
                                type="text"
                                placeholder="Your nickname"
                                value={signupName}
                                onChange={(e) => setSignupName(e.target.value)}
                                maxLength={30}
                                required
                              />
                              <input
                                type="tel"
                                placeholder="Phone number"
                                value={signupPhone}
                                onChange={(e) => setSignupPhone(e.target.value)}
                                required
                              />
                              {signupError && <p className="public-signup-error">{signupError}</p>}
                              <div className="public-signup-actions">
                                <button type="button" onClick={() => setSignupTableId(null)}>Cancel</button>
                                <button type="submit" disabled={signupLoading}>{signupLoading ? 'Adding...' : 'Add Me to List'}</button>
                              </div>
                            </form>
                          )}
                          {signupSuccess && signupTableId !== table.id && (
                            <p className="public-signup-success">{signupSuccess}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="public-signup-note">* 1/2 NLH games cannot be signed up for online — you must be present in the club to join the waitlist.</p>
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* High Hand Banner */}
      {highHandEnabled && (highHand || recentWinner) && (
        <div className={`tv-high-hand-banner ${recentWinner ? 'tv-hh-winner' : highHandRemaining <= 0 ? 'tv-hh-expired' : highHandRemaining < 300000 ? 'tv-hh-warning' : ''}`}>
          {recentWinner ? (
            <>
              <div className="tv-hh-trophy">🏆</div>
              <div className="tv-hh-content">
                <div className="tv-hh-label">HIGH HAND WINNER</div>
                <div className="tv-hh-player">{recentWinner.playerName}</div>
                <div className="tv-hh-hand">{recentWinner.handDescription}</div>
              </div>
              {recentWinner.cards && recentWinner.cards.length > 0 && (
                <div className="tv-hh-cards">
                  {recentWinner.cards.map(c => <PlayingCard key={c} card={c} size="sm" />)}
                </div>
              )}
              <div className="tv-hh-trophy">🏆</div>
            </>
          ) : highHand && (
            <>
              <div className="tv-hh-content">
                <div className="tv-hh-label">CURRENT HIGH HAND</div>
                <div className="tv-hh-player">
                  {highHand.playerName}
                  {highHand.tableNumber ? <span className="tv-hh-table"> — Table {highHand.tableNumber}</span> : null}
                </div>
                <div className="tv-hh-hand">{highHand.handDescription}</div>
              </div>
              {highHand.cards && highHand.cards.length > 0 && (
                <div className="tv-hh-cards">
                  {highHand.cards.map(c => <PlayingCard key={c} card={c} size="sm" />)}
                </div>
              )}
              <div className="tv-hh-clock">
                <div className="tv-hh-clock-label">{highHandRemaining <= 0 ? 'TIME UP' : 'Time Left'}</div>
                <div className={`tv-hh-clock-value ${highHandRemaining <= 0 ? 'expired' : highHandRemaining < 300000 ? 'warning' : ''}`}>
                  {(() => {
                    if (highHandRemaining <= 0) return '00:00';
                    const totalSec = Math.floor(highHandRemaining / 1000);
                    const m = Math.floor(totalSec / 60);
                    const s = totalSec % 60;
                    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                  })()}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ⚠️ PRODUCTION COMPONENT: PublicTableCard
 * 
 * Renders individual table cards for the public view.
 * This component is optimized for mobile-first display and must maintain
 * visual consistency with the dark theme and responsive design.
 * 
 * DO NOT modify without:
 * 1. Testing on actual mobile devices
 * 2. Verifying dark theme colors remain consistent
 * 3. Ensuring responsive breakpoints still work
 * 4. Confirming status color logic matches business rules
 */
function PublicTableCard({ display }: { display: TableDisplay }) {
  const { table, seatsFilled, playersWaitingElsewhere, waitlistPlayers } = display;

  /**
   * ⚠️ CRITICAL: Game label formatting
   * This function standardizes game type display names.
   * Modifications may break user expectations for game type labels.
   */
  const getGameLabel = (gameType: string, stakesText: string) => {
    if (stakesText.toLowerCase().includes('plo5')) return 'PLO5';
    if (gameType === 'NLH') return 'NL';
    if (gameType === 'BigO') return 'Big O';
    return gameType;
  };

  /**
   * ⚠️ CRITICAL: Buy-in range display logic
   * 
   * Priority order:
   * 1. Custom buy_in_limits from table (if set)
   * 2. Hardcoded fallback values based on stakes_text
   * 
   * DO NOT modify hardcoded fallback values without:
   * - Confirming with business stakeholders
   * - Updating all other views (Admin, TV, Tablet) to match
   * - Testing all stake combinations
   */
  const getBuyInRange = (table: PokerTable) => {
    // Always prioritize custom buy-in limits if set
    if (table.buy_in_limits && table.buy_in_limits.trim()) {
      return table.buy_in_limits.trim();
    }

    // ⚠️ CRITICAL: Hardcoded fallback values - DO NOT MODIFY WITHOUT APPROVAL
    // These values are business-critical and must match across all views
    const text = table.stakes_text.toLowerCase();
    if (text.includes('$1/$2') && text.includes('nl')) return '$40-$500';
    if (text.includes('$1/$3') && text.includes('nl')) return '$300-$1000';
    if (text.includes('plo5') || text.includes('$1/$2/$5')) return '$200-$1000';
    return '';
  };

  const getStatusColor = () => {
    const totalSeats = table.seats_total || 20;
    const filledPercent = (seatsFilled / totalSeats) * 100;
    if (filledPercent >= 90) return 'full';
    if (filledPercent >= 70) return 'busy';
    return 'open';
  };

  const status = getStatusColor();
  const gameLabel = getGameLabel(table.game_type, table.stakes_text);
  const buyInRange = getBuyInRange(table);
  const bombPotCount = table.bomb_pot_count || 0;
  const lockoutCount = table.lockout_count || 0;

  return (
    <div className={`mobile-tv-card ${status}`}>
      <div className="mobile-tv-card-header">
        <div className="mobile-tv-table-info">
          <h3>Table {table.table_number}</h3>
          <div className="mobile-tv-game-type">{gameLabel} • {table.stakes_text.replace(/No Limit/gi, 'NL')}</div>
        </div>
        <div className="mobile-tv-status-badge">
          <span className={`status-dot ${status}`}></span>
          {status === 'full' ? 'Full' : status === 'busy' ? 'Busy' : 'Open'}
        </div>
      </div>

      {buyInRange ? (
        <div className="mobile-tv-buyin">Buy-in {buyInRange}</div>
      ) : (
        <div className="mobile-tv-buyin" style={{ opacity: 0.5 }}>Buy-in See Floor</div>
      )}

      <div className="public-player-lists">
        {/* Seated count indicator */}
        <div className="public-seated-count">
          <span className="public-seated-count-number">{seatsFilled}</span>
          <span className="public-seated-count-label">Seated</span>
        </div>

        {/* Waitlist count only — player names shown in game type summary */}
        {waitlistPlayers.length > 0 && (
          <div className="public-waitlist-count-row">
            <span className="public-waitlist-count-label">Waitlist</span>
            <span className="public-waitlist-count-number">{waitlistPlayers.length}</span>
          </div>
        )}
      </div>

      {playersWaitingElsewhere > 0 && (
        <div className="mobile-tv-waiting-elsewhere">
          {playersWaitingElsewhere} seated player{playersWaitingElsewhere !== 1 ? 's' : ''} waiting elsewhere
        </div>
      )}

      {(bombPotCount > 0 || lockoutCount > 0) && (
        <div className="mobile-tv-game-features">
          {bombPotCount > 0 && (
            <span className="mobile-tv-bomb-pots">
              💣 {bombPotCount} Bomb Pot{bombPotCount !== 1 ? 's' : ''}
            </span>
          )}
          {lockoutCount > 0 && (
            <span className="mobile-tv-lockouts">
              🔒 {lockoutCount} Lockout{lockoutCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
