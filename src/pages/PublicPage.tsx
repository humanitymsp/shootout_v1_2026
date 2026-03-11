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

import { useEffect, useState } from 'react';
import { getActiveClubDay, getTablesForClubDay, getAllPlayers, getCheckInForPlayer } from '../lib/api';
import { getTableCounts } from '../lib/tableCounts';
import { generateClient } from '../lib/graphql-client';
import { initializeLocalPlayers, startPlayerSyncPolling } from '../lib/localStoragePlayers';
import { getPersistentTables } from '../lib/persistentTables';
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

    // ⚠️ CRITICAL: Real-time player synchronization from admin device
    // This ensures public view stays in sync with admin changes
    // DO NOT modify polling intervals without testing impact on real-time updates
    const stopPlayerSync = startPlayerSyncPolling(clubDay.id, (players) => {
      log(`📡 Public: Synced ${players.length} players from admin`);
    }, 3000, 'apiKey'); // Poll every 3 seconds with apiKey auth for public access

    // ⚠️ CRITICAL: Data refresh polling for near-realtime table updates
    // 2000ms interval balances responsiveness with server load
    // Changing this may cause delays in showing table updates to public users
    const pollInterval = setInterval(() => {
      if (document.hidden) return;
      loadData();
    }, 8000); // BroadcastChannel handles instant updates; this is a fallback

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
        log('📱 Public: Received storage event, refreshing');
        loadData();
      }
    };
    
    // ⚠️ CRITICAL: Poll for localStorage changes (same-tab updates)
    // StorageEvent doesn't fire in the same tab, so we poll every 300ms
    // This 300ms interval is optimized for responsiveness vs performance
    // Changing this interval may cause delays or increase CPU usage
    let lastProcessedUpdate: string | null = null;
    const pollInterval = setInterval(() => {
      const lastTableUpdate = localStorage.getItem('table-updated');
      const lastTvUpdate = localStorage.getItem('tv-updated');
      const lastPlayerUpdate = localStorage.getItem('player-updated');
      
      const latestUpdate = lastTableUpdate || lastTvUpdate || lastPlayerUpdate;
      if (latestUpdate && latestUpdate !== lastProcessedUpdate) {
        const updateTime = new Date(latestUpdate).getTime();
        const now = Date.now();
        // Refresh if update was within last 10 seconds
        // CRITICAL: This 10-second window prevents stale updates from triggering refreshes
        if (now - updateTime < 10000) {
          lastProcessedUpdate = latestUpdate;
          log('📱 Public: Detected localStorage update, refreshing');
          loadData();
        }
      }
    }, 1000); // 1s is sufficient — BroadcastChannel + StorageEvent handle instant updates

    // ⚠️ CRITICAL: BroadcastChannel for same-origin real-time messaging
    // This provides instant updates across tabs/windows without polling delays
    // DO NOT remove these channels - they are essential for real-time sync
    let adminChannel: BroadcastChannel | null = null;
    let tvChannel: BroadcastChannel | null = null;
    let publicChannel: BroadcastChannel | null = null;

    try {
      adminChannel = new BroadcastChannel('admin-updates');
      adminChannel.addEventListener('message', (event) => {
        // Refresh on any table or player updates (including buy-in limits)
        // CRITICAL: This ensures public view reflects admin changes immediately
        if (event.data?.type === 'player-update' || event.data?.type === 'table-update') {
          log('📱 Public: Received admin update, refreshing immediately');
          loadData();
        }
      });
    } catch (error) {
      logWarn('Admin BroadcastChannel not available:', error);
    }

    try {
      tvChannel = new BroadcastChannel('tv-updates');
      tvChannel.addEventListener('message', (event) => {
        // Refresh on any TV updates, especially table updates (buy-in limits)
        // CRITICAL: TV view updates must propagate to public view immediately
        if (event.data?.type === 'table-update' || event.data?.type === 'table-updated') {
          log('📱 Public: Received TV update, refreshing immediately');
          loadData();
        } else {
          loadData();
        }
      });
    } catch (error) {
      logWarn('TV BroadcastChannel not available:', error);
    }

    try {
      publicChannel = new BroadcastChannel('public-updates');
      publicChannel.addEventListener('message', (event) => {
        if (event.data?.type === 'public-toggle') {
          log('📱 Public: Received public visibility toggle, refreshing immediately');
          loadData();
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
  const loadData = async () => {
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
      const patchPlayerData = <T extends { player_id: string; player?: any }>(items: T[]): T[] => {
        return items.map(item => {
          if (item.player?.nick || item.player?.name) return item;
          const p = playerMap.get(item.player_id);
          if (p) {
            return { ...item, player: { id: item.player_id, name: p.name, nick: p.nick } };
          }
          return item;
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
      log('Public: Visible tables:', tables.map(t => `Table ${t.table_number} (${t.status})`));

      const displays: TableDisplay[] = [];

      for (const table of tables) {
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

      // ⚠️ CRITICAL: Sort by table number for consistent display order
      // Users expect tables to appear in numerical order
      displays.sort((a, b) => a.table.table_number - b.table.table_number);

      log('Public: Final displays:', displays.map(d => `Table ${d.table.table_number}`));

      setTableDisplays(displays);
    } catch (error) {
      logError('Error loading public page data:', error);
    } finally {
      setLoading(false);
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

                return Array.from(grouped.values()).map(({ gameType, stakes, displays }) => {
                  const headerLabel = stakes ? `${gameType} — ${stakes}` : gameType;

                  // Collect all waitlist player names across tables in this group
                  const groupWaitlist: { id: string; name: string }[] = [];
                  const seenPlayerIds = new Set<string>();
                  displays.forEach(d => {
                    d.waitlistPlayers.forEach(wl => {
                      if (!seenPlayerIds.has(wl.player_id)) {
                        seenPlayerIds.add(wl.player_id);
                        groupWaitlist.push({
                          id: wl.id,
                          name: wl.player?.nick || wl.player?.name || 'Unknown',
                        });
                      }
                    });
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
                        {displays.map((d) => (
                          <div key={d.table.id} className="public-summary-table-row">
                            <span className="public-summary-table-num">Table {d.table.table_number}</span>
                            <span className="public-summary-table-seats">{d.seatsFilled}/{d.table.seats_total || 9}</span>
                            {(d.table.bomb_pot_count || 0) > 0 && (
                              <span className="public-summary-bomb">💣 {d.table.bomb_pot_count} BP</span>
                            )}
                            {(d.table.lockout_count || 0) > 0 && (
                              <span className="public-summary-lockout">🔒 {d.table.lockout_count} LO</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {groupWaitlist.length > 0 && (
                        <div className="public-group-waitlist-summary">
                          <div className="public-group-waitlist-label">
                            Waitlist <span className="public-group-waitlist-count">{groupWaitlist.length}</span>
                          </div>
                          <div className="public-group-waitlist-names">
                            {(() => {
                              const cols: { id: string; name: string }[][] = [];
                              for (let i = 0; i < groupWaitlist.length; i += 10) {
                                cols.push(groupWaitlist.slice(i, i + 10));
                              }
                              return cols.map((col, ci) => (
                                <div key={ci} className="public-waitlist-col">
                                  {col.map((p) => (
                                    <span key={p.id} className="public-group-waitlist-name">{p.name}</span>
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
                              <span className="public-seated-count-label">/ {table.seats_total || 9} Seated</span>
                            </div>

                            <div className="public-player-section public-waitlist-section">
                              <div className="public-section-header">
                                <span className="public-section-title">Waitlist</span>
                              </div>
                              <ul className="public-player-names">
                                {waitlistPlayers.length > 0 ? (
                                  waitlistPlayers.map((wl) => (
                                    <li key={wl.id} className="public-player-name public-waiting-player">
                                      {wl.player?.nick || wl.player?.name || 'Unknown'}
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
    if (text.includes('$1/$2') && text.includes('nl')) return '$40-$400';
    if (text.includes('$1/$3') && text.includes('nl')) return '$300-$1000';
    if (text.includes('plo5') || text.includes('$1/$2/$5')) return '$200-$1000';
    return '';
  };

  const getStatusColor = () => {
    const totalSeats = table.seats_total || 9;
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
          <span className="public-seated-count-label">/ {table.seats_total || 9} Seated</span>
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
