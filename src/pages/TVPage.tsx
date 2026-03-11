import { useEffect, useState, useRef } from 'react';
import { getActiveClubDay, getTablesForClubDay } from '../lib/api';
import { getTableCounts } from '../lib/tableCounts';
import { generateClient } from '../lib/graphql-client';
import { initializeLocalPlayers, startPlayerSyncPolling } from '../lib/localStoragePlayers';
import { log, logWarn, logError } from '../lib/logger';
import { getHighHand, isHighHandEnabled, getRemainingTimeMs, getHighHandWinners } from '../lib/highHand';
import type { HighHand, HighHandWinner } from '../lib/highHand';
import { getPersistentTables } from '../lib/persistentTables';
import type { ClubDay, PokerTable, TableSeat, TableWaitlist } from '../types';
import Logo from '../components/Logo';
import PlayingCard from '../components/PlayingCard';
import './TVPage.css';
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

// Cache keys for localStorage
const CACHE_KEY_CLUB_DAY = 'tv-cache-club-day';
const CACHE_KEY_TABLE_DISPLAYS = 'tv-cache-table-displays';
const CACHE_KEY_TIMESTAMP = 'tv-cache-timestamp';
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Cache helpers
function saveToCache(clubDay: ClubDay | null, tableDisplays: TableDisplay[]) {
  try {
    if (clubDay) {
      localStorage.setItem(CACHE_KEY_CLUB_DAY, JSON.stringify(clubDay));
    }
    localStorage.setItem(CACHE_KEY_TABLE_DISPLAYS, JSON.stringify(tableDisplays));
    localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now().toString());
  } catch (error) {
    logWarn('Failed to save TV cache:', error);
  }
}

function loadFromCache(): { clubDay: ClubDay | null; tableDisplays: TableDisplay[] } | null {
  try {
    const timestamp = localStorage.getItem(CACHE_KEY_TIMESTAMP);
    if (!timestamp) return null;
    
    const age = Date.now() - parseInt(timestamp, 10);
    if (age > CACHE_MAX_AGE) {
      // Cache expired, clear it
      localStorage.removeItem(CACHE_KEY_CLUB_DAY);
      localStorage.removeItem(CACHE_KEY_TABLE_DISPLAYS);
      localStorage.removeItem(CACHE_KEY_TIMESTAMP);
      return null;
    }
    
    const clubDayStr = localStorage.getItem(CACHE_KEY_CLUB_DAY);
    const tableDisplaysStr = localStorage.getItem(CACHE_KEY_TABLE_DISPLAYS);
    
    if (!tableDisplaysStr) return null;
    
    const clubDay = clubDayStr ? JSON.parse(clubDayStr) : null;
    const tableDisplays = JSON.parse(tableDisplaysStr);
    
    return { clubDay, tableDisplays };
  } catch (error) {
    logWarn('Failed to load TV cache:', error);
    return null;
  }
}

export default function TVPage() {
  const [clubDay, setClubDay] = useState<ClubDay | null>(null);
  const [tableDisplays, setTableDisplays] = useState<TableDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useRef<any>(null);
  const retryCountRef = useRef(0);
  const [highHand, setHighHand] = useState<HighHand | null>(getHighHand());
  const [highHandEnabled, setHighHandEnabled] = useState(isHighHandEnabled());
  const [highHandRemaining, setHighHandRemaining] = useState(getRemainingTimeMs());
  const [recentWinner, setRecentWinner] = useState<HighHandWinner | null>(null);

  useEffect(() => {
    // Initialize localStorage players system
    initializeLocalPlayers();
    
    // Try to load cached data first for instant display
    const cached = loadFromCache();
    if (cached) {
      setClubDay(cached.clubDay);
      setTableDisplays(cached.tableDisplays);
      setLoading(false);
      // Still try to fetch fresh data in background
      loadData(true); // Pass true to indicate we have cached data
    } else {
      loadData();
    }
  }, []);

  useEffect(() => {
    if (!clubDay) return;

    // Start syncing players from admin device
    const stopPlayerSync = startPlayerSyncPolling(clubDay.id, (players) => {
      // Players are synced, but we don't need to do anything here
      // The player data will be used when displaying seats/waitlists
      log(`📡 TV: Synced ${players.length} players from admin`);
    }, 3000); // Poll every 3 seconds for player updates

    // Reduced polling frequency - use BroadcastChannel for instant updates instead
    const pollInterval = setInterval(() => {
      // Skip polling if tab is hidden (better performance)
      if (document.hidden) return;
      // Skip polling if offline (will retry when online)
      if (isOffline) return;
      loadData();
    }, 5000); // Slower polling - BroadcastChannel handles instant updates

    return () => {
      clearInterval(pollInterval);
      stopPlayerSync();
    };
  }, [clubDay, isOffline]);

  // Guaranteed full refresh every 2 minutes regardless of events or clubDay state
  useEffect(() => {
    const autoRefreshInterval = setInterval(() => {
      if (!document.hidden && !isOffline) {
        log('📺 TV: Auto-refresh (2 min interval)');
        loadData();
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(autoRefreshInterval);
  }, [isOffline]);

  useEffect(() => {
    // Update clock every second + high hand countdown
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
      // Update high hand countdown
      if (highHandEnabled) {
        const ms = getRemainingTimeMs();
        setHighHandRemaining(ms);
      }
    }, 1000);

    return () => clearInterval(clockInterval);
  }, [highHandEnabled]);

  // Listen for high hand updates from admin
  useEffect(() => {
    const handleHighHandUpdate = (e: StorageEvent) => {
      if (e.key === 'high-hand-updated') {
        const hand = getHighHand();
        const nowEnabled = isHighHandEnabled();
        setHighHandEnabled(nowEnabled);

        // Check if a winner was just declared (had a hand, now null)
        if (highHand && !hand && nowEnabled) {
          const winners = getHighHandWinners();
          if (winners.length > 0) {
            setRecentWinner(winners[0]);
            // Show winner for 30 seconds then clear
            setTimeout(() => setRecentWinner(null), 30000);
          }
        }

        setHighHand(hand);
        if (hand) {
          setHighHandRemaining(getRemainingTimeMs());
        }
      }
    };
    window.addEventListener('storage', handleHighHandUpdate);

    // Also poll for same-tab changes
    let lastHighHandUpdate = localStorage.getItem('high-hand-updated');
    const pollHH = setInterval(() => {
      const current = localStorage.getItem('high-hand-updated');
      if (current !== lastHighHandUpdate) {
        lastHighHandUpdate = current;
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
      window.removeEventListener('storage', handleHighHandUpdate);
      clearInterval(pollHH);
    };
  }, [highHand, highHandEnabled]);

  // Listen for day-reset events from admin page (EOD reset)
  useEffect(() => {
    const handleStorageReset = (event: StorageEvent) => {
      if (event.key === 'day-reset') {
        log('📡 TV: Day reset detected, reloading...');
        window.location.reload();
      }
    };
    window.addEventListener('storage', handleStorageReset);

    return () => window.removeEventListener('storage', handleStorageReset);
  }, []);


  useEffect(() => {
    // Listen for instant TV refresh signals from admin
    let lastProcessedUpdate: string | null = null;
    
    const handleStorage = (e: StorageEvent) => {
      // If day was reset, do a full browser refresh
      if (e.key === 'day-reset') {
        log('📺 TV: Day reset detected, refreshing browser');
        window.location.reload();
        return;
      }
      if (e.key === 'tv-updated' || e.key === 'table-updated' || e.key === 'player-updated') {
        loadData();
      }
    };
    window.addEventListener('storage', handleStorage);

    // Poll for localStorage changes (since same-tab changes don't trigger storage events)
    // Reduced interval for faster updates, especially for buy-in limits
    const pollInterval = setInterval(() => {
      const lastTableUpdate = localStorage.getItem('table-updated');
      const lastPlayerUpdate = localStorage.getItem('player-updated');
      const lastTvUpdate = localStorage.getItem('tv-updated');
      
      const latestUpdate = lastTableUpdate || lastPlayerUpdate || lastTvUpdate;
      if (latestUpdate && latestUpdate !== lastProcessedUpdate) {
        const updateTime = new Date(latestUpdate).getTime();
        const now = Date.now();
        // Refresh if update was within last 10 seconds and we haven't processed it
        // Extended window to catch all updates
        if (now - updateTime < 10000) {
          lastProcessedUpdate = latestUpdate;
          log('📺 TV: Detected localStorage update, refreshing immediately');
          loadData();
        }
      }
    }, 300); // Reduced from 1000ms to 300ms for faster response

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('tv-updates');
      channel.onmessage = (event) => {
        // Immediately refresh on any TV update, especially table updates
        if (event.data?.type === 'table-update') {
          log('📺 TV: Received table update broadcast (buy-in limits?), refreshing immediately');
          // Force immediate refresh for buy-in limits
          loadData();
        } else {
          loadData();
        }
      };
    } catch {
      // BroadcastChannel not supported
    }
    
    // Also listen to admin-updates channel for table changes
    let adminChannel: BroadcastChannel | null = null;
    try {
      adminChannel = new BroadcastChannel('admin-updates');
      adminChannel.onmessage = (event) => {
        // Refresh on table-related updates from admin page (including buy-in limits)
        if (event.data?.type === 'player-update' || event.data?.type === 'table-update') {
          log('📺 TV: Received admin update, refreshing table data');
          // Use a small delay to ensure server has processed the change
          setTimeout(() => {
            loadData();
          }, 500);
        }
      };
    } catch {
      // BroadcastChannel not supported
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(pollInterval);
      if (channel) channel.close();
      if (adminChannel) adminChannel.close();
    };
  }, []);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      log('📺 TV: Connection restored, refreshing data');
      setIsOffline(false);
      retryCountRef.current = 0;
      loadData();
    };

    const handleOffline = () => {
      log('📺 TV: Connection lost, using cached data');
      setIsOffline(true);
    };

    // Check initial online status
    setIsOffline(!navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadData = async (hasCachedData = false) => {
    try {
      const activeDay = await getActiveClubDay();
      if (activeDay) {
        setClubDay(activeDay);
        const tablesData = await getTablesForClubDay(activeDay.id);
        await loadTableDisplays(tablesData, activeDay);
        
        // Success - reset retry count and update timestamp
        retryCountRef.current = 0;
        setIsOffline(false);
        setLastUpdateTime(new Date());
      } else if (!hasCachedData) {
        // No active day and no cached data - show empty state
        setClubDay(null);
        setTableDisplays([]);
      }
    } catch (error) {
      logError('Error loading TV data:', error);
      
      // Check if we have cached data to fall back to
      const cached = loadFromCache();
      if (cached && (cached.clubDay || cached.tableDisplays.length > 0)) {
        log('📺 TV: Using cached data due to network error');
        setClubDay(cached.clubDay);
        setTableDisplays(cached.tableDisplays);
        setIsOffline(true);
        
        // Schedule retry with exponential backoff
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        
        const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000); // Max 30 seconds
        retryCountRef.current++;
        
        retryTimeoutRef.current = setTimeout(() => {
          if (navigator.onLine) {
            loadData(true);
          }
        }, retryDelay);
      } else if (!hasCachedData) {
        // No cache available and network failed - show empty state
        setClubDay(null);
        setTableDisplays([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadTableDisplays = async (tables: PokerTable[], activeClubDay: ClubDay | null) => {
    // Deduplicate tables by table_number (keep latest)
    const uniqueTables = Array.from(
      new Map(tables.map((table) => [table.table_number, table])).values()
    );
    
    // Patch is_persistent flag from localStorage persistent metadata
    const pts = getPersistentTables();
    const ptIds = new Set(pts.filter(pt => pt.api_table_id).map(pt => pt.api_table_id));
    const ptNumsNoId = new Set(pts.filter(pt => !pt.api_table_id).map(pt => pt.table_number));
    uniqueTables.forEach(t => {
      if (ptIds.has(t.id) || ptNumsNoId.has(t.table_number)) t.is_persistent = true;
    });

    const activeTables = uniqueTables.filter(
      (t) => t.status !== 'CLOSED' && t.show_on_tv !== false
    );

    const displays: TableDisplay[] = [];

    for (const table of activeTables) {
      // Use centralized counting function - SINGLE SOURCE OF TRUTH
      // CRITICAL: Pass clubDayId to prevent counting players from old club days
      // Use activeClubDay parameter (not state) to ensure we have the correct ID
      const counts = await getTableCounts(table.id, activeClubDay?.id);
      const seatsFilled = counts.seatedCount;
      const waitlistCount = counts.waitlistCount;
      
      // Debug logging for Table 14 specifically
      if (table.table_number === 14) {
        log(`📺 TV: Table 14 - seatsFilled: ${seatsFilled}, seatedPlayers.length: ${counts.seatedPlayers.length}, clubDayId: ${activeClubDay?.id}`);
        log(`📺 TV: Table 14 - Raw seats from API: ${counts.seatedPlayers.length}, Unique players after deduplication: ${seatsFilled}`);
      }

      // Count players seated here who are waiting at another table
      let playersWaitingElsewhere = 0;
      for (const seat of counts.seatedPlayers) {
        const { data: otherWaitlists } = await client.models.TableWaitlist.list({
          filter: {
            playerId: { eq: seat.player_id },
            removedAt: { attributeExists: false },
          },
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
        seatedPlayers: counts.seatedPlayers,
        waitlistPlayers: counts.waitlistPlayers,
      });
    }

    // Sort by creation time so new tables appear at the end
    displays.sort((a, b) => new Date(a.table.created_at).getTime() - new Date(b.table.created_at).getTime());

    setTableDisplays(displays);
    
    // Save to cache after successful load
    saveToCache(activeClubDay, displays);
  };

  if (loading) {
    return (
      <div className="tv-page loading">
        <div className="tv-loading-content">
          <div className="tv-loading-spinner"></div>
          <h2>Loading Poker Tables...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-page">
      <div className="tv-header">
        <div className="tv-header-left">
          <div className="tv-logo-section">
            <Logo />
          </div>
        </div>
        <div className="tv-header-center">
          <h1 className="tv-main-title">CASH GAME WAITLIST</h1>
        </div>
        <div className="tv-header-right">
          <div className="tv-datetime">
            <span className="tv-date">
              {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <span className="tv-datetime-separator">•</span>
            <span className="tv-time">
              {currentTime.getHours() % 12 || 12}:{currentTime.getMinutes().toString().padStart(2, '0')}
              <span className="tv-time-period">
                {currentTime.getHours() >= 12 ? 'PM' : 'AM'}
              </span>
            </span>
          </div>
          {isOffline && (
            <div className="tv-offline-indicator" title="Using cached data - connection lost">
              <span className="tv-offline-text">Offline</span>
              {lastUpdateTime && (
                <span className="tv-offline-time">
                  Last updated: {lastUpdateTime.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div ref={gridRef} className="tv-columns-container" style={{
        gridTemplateColumns: `repeat(${(() => {
          const seen = new Set<string>();
          for (const d of tableDisplays) seen.add(`${d.table.game_type || 'Other'}||${d.table.stakes_text || ''}`);
          return Math.max(1, seen.size);
        })()}, 1fr)`
      }}>
        {(() => {
          // Group tables by game type + stakes
          const groups = new Map<string, { gameType: string; stakes: string; displays: TableDisplay[] }>();
          for (const display of tableDisplays) {
            const gameType = display.table.game_type || 'Other';
            const stakes = display.table.stakes_text || '';
            const groupKey = `${gameType}||${stakes}`;
            if (!groups.has(groupKey)) {
              groups.set(groupKey, { gameType, stakes, displays: [] });
            }
            groups.get(groupKey)!.displays.push(display);
          }

          return Array.from(groups.values()).map(({ gameType, stakes, displays }) => {
            const headerLabel = stakes ? `${gameType} — ${stakes}` : gameType;

            // Aggregate unique waitlisted players across all tables in this group
            const seenPlayerIds = new Set<string>();
            const groupWaitlist: { id: string; name: string }[] = [];
            for (const d of displays) {
              for (const wl of d.waitlistPlayers) {
                if (!wl.called_in && !seenPlayerIds.has(wl.player_id)) {
                  seenPlayerIds.add(wl.player_id);
                  groupWaitlist.push({
                    id: wl.player_id,
                    name: wl.player?.nick || wl.player?.name || 'Unknown',
                  });
                }
              }
            }

            // Aggregate total seated / total seats for this group
            const totalSeated = displays.reduce((sum, d) => sum + d.seatsFilled, 0);
            const totalSeats = displays.reduce((sum, d) => sum + (d.table.seats_total || 9), 0);

            return (
              <div key={`${gameType}||${stakes}`} className="tv-column">
                <div className="tv-column-header">
                  <h2 className="tv-column-title">{headerLabel}</h2>
                  <div className="tv-column-stats">
                    <span className="tv-column-stat">{displays.length} Table{displays.length !== 1 ? 's' : ''}</span>
                    <span className="tv-column-stat">{totalSeated}/{totalSeats} Seats</span>
                  </div>
                </div>

                <div className="tv-column-body">
                  {/* Table info summary */}
                  <div className="tv-column-table-summary">
                    {displays.map((d) => (
                      <div key={d.table.id} className="tv-summary-table-row">
                        <span className="tv-summary-table-num">Table {d.table.table_number}</span>
                        <span className="tv-summary-table-seats">{d.seatsFilled}/{d.table.seats_total || 9}</span>
                        {(d.table.bomb_pot_count || 0) > 0 && (
                          <span className="tv-summary-bomb">💣 {d.table.bomb_pot_count} BP</span>
                        )}
                        {(d.table.lockout_count || 0) > 0 && (
                          <span className="tv-summary-lockout">🔒 {d.table.lockout_count} LO</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Waitlist summary */}
                  <div className="tv-column-waitlist">
                    <div className="tv-column-waitlist-header">
                      Waitlist <span className="tv-column-waitlist-count">{groupWaitlist.length}</span>
                    </div>
                    {groupWaitlist.length > 0 ? (
                      <div className="tv-column-waitlist-names">
                        {(() => {
                          const cols: { id: string; name: string }[][] = [];
                          for (let i = 0; i < groupWaitlist.length; i += 10) {
                            cols.push(groupWaitlist.slice(i, i + 10));
                          }
                          return cols.map((col, ci) => (
                            <div key={ci} className="tv-waitlist-col">
                              {col.map((p) => (
                                <span key={p.id} className="tv-column-waitlist-name">{p.name}</span>
                              ))}
                            </div>
                          ));
                        })()}
                      </div>
                    ) : (
                      <div className="tv-column-waitlist-empty">No one waiting</div>
                    )}
                  </div>

                </div>
              </div>
            );
          });
        })()}
      </div>

      {tableDisplays.length === 0 && (
        <div className="tv-empty">
          <div className="tv-empty-content">
            <h2>No Active Games</h2>
            <p>Check back later for poker action!</p>
          </div>
        </div>
      )}

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
                  {recentWinner.cards.map(c => <PlayingCard key={c} card={c} size="tv" />)}
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
                  {highHand.cards.map(c => <PlayingCard key={c} card={c} size="tv" />)}
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

