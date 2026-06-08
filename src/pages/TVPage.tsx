import { useEffect, useState, useRef } from 'react';
import { getActiveClubDay, getTablesForClubDay, toPokerTable } from '../lib/api';
import { queryClubDayCompound } from '../lib/gsiQueries';
import { getAllTableCountsForClubDay } from '../lib/tableCounts';
import { initializeLocalPlayers, startPlayerSyncPolling, setActiveClubDayIdForCache } from '../lib/localStoragePlayers';
import { log, logWarn, logError } from '../lib/logger';
import { getHighHand, isHighHandEnabled, getRemainingTimeMs, getHighHandWinners } from '../lib/highHand';
import type { HighHand, HighHandWinner } from '../lib/highHand';
import { getPersistentTables, getTableWaitlist as getPersistentWaitlist } from '../lib/persistentTables';
import type { ClubDay, PokerTable, TableSeat, TableWaitlist } from '../types';
import Logo from '../components/Logo';
import PlayingCard from '../components/PlayingCard';
import { useGoogleCast } from '../hooks/useGoogleCast';
import { createWorkerInterval } from '../lib/workerTimer';
import './TVPage.css';
import '../components/HighHandBanner.css';


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
  const [isCasting, setIsCasting] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useRef<any>(null);
  const isLoadingRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);
  const fastDebounceTimerRef = useRef<any>(null);
  
  // Google Cast functionality
  const cast = useGoogleCast();
  const retryCountRef = useRef(0);
  const clubDayIdRef = useRef<string | null>(null);
  
  // Sync isCasting state with cast.isConnected for CSS class
  useEffect(() => {
    setIsCasting(cast.isConnected);
  }, [cast.isConnected]);

  // Keyboard shortcut for casting (Ctrl+Shift+C)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        if (cast.isConnected) {
          cast.stopCast();
        } else if (cast.isAvailable) {
          cast.requestCast();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cast]);
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
      // Players are synced — data used when displaying seats/waitlists
    }, 30000, 'apiKey'); // Poll every 30 seconds, use apiKey auth for TV

    // Use Worker-based timer for data polling — immune to Chrome's background
    // tab throttling which can stall setInterval to 1min+ (or 10min+ in some cases).
    // This ensures the TV display updates reliably even when the tab is being cast.
    const stopWorkerPoll = createWorkerInterval(() => {
      if (isOffline) return;
      loadData();
    }, 30000); // 30s — worker ensures it fires reliably even in background tabs

    // Immediate refresh when tab visibility changes (e.g. user switches back to tab)
    const handleVisibility = () => {
      if (!document.hidden && !isOffline) {
        loadData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopWorkerPoll();
      stopPlayerSync();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [clubDay, isOffline]);


  useEffect(() => {
    // Update clock every 60s — seconds display removed to prevent per-second
    // re-renders, which cause Chrome tab-capture to classify the page as animated
    // and permanently downgrade Chromecast resolution.
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    // High hand countdown — keep separate so clock changes don't retrigger this
    if (!highHandEnabled) return;
    const hhInterval = setInterval(() => {
      setHighHandRemaining(getRemainingTimeMs());
    }, 1000);
    return () => clearInterval(hhInterval);
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
    }, 2000);

    return () => {
      window.removeEventListener('storage', handleHighHandUpdate);
      clearInterval(pollHH);
    };
  }, [highHand, highHandEnabled]);

  // Listen for day-reset events from admin page (EOD reset)
  useEffect(() => {
    const handleStorageReset = (event: StorageEvent) => {
      if (event.key === 'day-reset') {
        // Day reset detected, reloading...
        window.location.reload();
      }
    };
    window.addEventListener('storage', handleStorageReset);

    return () => window.removeEventListener('storage', handleStorageReset);
  }, []);


  useEffect(() => {
    // Listen for instant TV refresh signals from admin
    const handleStorage = (e: StorageEvent) => {
      // If day was reset, do a full browser refresh
      if (e.key === 'day-reset') {
        window.location.reload();
        return;
      }
      if (e.key === 'tv-updated' || e.key === 'table-updated' || e.key === 'player-updated') {
        debouncedRefresh();
      }
    };
    window.addEventListener('storage', handleStorage);

    // tv-updates: table show/hide toggles, table management actions
    let tvChannel: BroadcastChannel | null = null;
    try {
      tvChannel = new BroadcastChannel('tv-updates');
      tvChannel.onmessage = () => fastRefresh();
    } catch {
      // BroadcastChannel not supported
    }

    // admin-updates: player seat/move/remove — admin and TV are on the same device,
    // so BroadcastChannel delivers this instantly (<5ms). Use fast 300ms debounce.
    let adminChannel: BroadcastChannel | null = null;
    try {
      adminChannel = new BroadcastChannel('admin-updates');
      adminChannel.onmessage = () => fastRefresh();
    } catch {
      // BroadcastChannel not supported
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      if (tvChannel) tvChannel.close();
      if (adminChannel) adminChannel.close();
    };
  }, []);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      // Connection restored, refreshing data
      setIsOffline(false);
      retryCountRef.current = 0;
      loadData();
    };

    const handleOffline = () => {
      // Connection lost, using cached data
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
    // Concurrency guard - skip if already loading
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    
    try {
      // Only fetch activeClubDay on first load or if not cached yet.
      // ClubDay ID doesn't change during a session — skip the extra AppSync call on polls.
      let activeDayId = clubDayIdRef.current;
      if (!activeDayId) {
        const activeDay = await getActiveClubDay();
        if (activeDay) {
          activeDayId = activeDay.id;
          clubDayIdRef.current = activeDayId;
          setActiveClubDayIdForCache(activeDay.id);
          setClubDay(activeDay);
        }
      }
      if (activeDayId) {
        // COMPOUND QUERY: tables + seats + waitlist in ONE GraphQL request (4 ops vs 7)
        const compound = await queryClubDayCompound(activeDayId);
        const compoundOk = compound.tables.length > 0;
        const tablesData = compoundOk
          ? compound.tables.map(toPokerTable)
          : await getTablesForClubDay(activeDayId); // fallback
        const prefetchedForCounts = compoundOk
          ? { seats: compound.seats, waitlist: compound.waitlist }
          : undefined;
        await loadTableDisplays(tablesData, clubDay, prefetchedForCounts);
        
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
        // Using cached data due to network error
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
      isLoadingRef.current = false;
    }
  };

  // Fast debounce (300ms) — for direct same-device signals from admin-updates channel.
  // Admin and TV are on the same machine; no need to wait for AppSync propagation.
  const fastRefresh = () => {
    if (fastDebounceTimerRef.current) clearTimeout(fastDebounceTimerRef.current);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    fastDebounceTimerRef.current = setTimeout(() => {
      loadData();
    }, 300);
  };

  // Slow debounce (3s) — for storage events which may arrive slightly after the write
  const debouncedRefresh = () => {
    if (fastDebounceTimerRef.current) return; // fast path already scheduled, skip
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      loadData();
    }, 3000);
  };

  const loadTableDisplays = async (tables: PokerTable[], activeClubDay: ClubDay | null, prefetchedData?: { seats: any[]; waitlist: any[] }) => {
    // Deduplicate tables by table_number (keep latest)
    const uniqueTables = Array.from(
      new Map(tables.map((table) => [table.table_number, table])).values()
    );
    
    // Validate persistent tables against current club day's API tables
    // If api_table_id is stale (from a previous day), rebind by table_number
    const pts = getPersistentTables();
    const validTableIds = new Set(tables.map(t => t.id));
    const apiTableByNumber = new Map(tables.map(t => [t.table_number, t]));
    const validPts = pts.map(pt => {
      if (pt.status === 'CLOSED') return null;
      if (pt.api_table_id && validTableIds.has(pt.api_table_id)) return pt;
      if (pt.api_table_id && !validTableIds.has(pt.api_table_id)) {
        const match = apiTableByNumber.get(pt.table_number);
        if (match && match.status !== 'CLOSED') return { ...pt, api_table_id: match.id };
        return null;
      }
      return pt;
    }).filter(Boolean) as typeof pts;
    const ptIds = new Set(validPts.filter(pt => pt.api_table_id).map(pt => pt.api_table_id));
    const ptNumsNoId = new Set(validPts.filter(pt => !pt.api_table_id).map(pt => pt.table_number));
    uniqueTables.forEach(t => {
      if (ptIds.has(t.id) || ptNumsNoId.has(t.table_number)) t.is_persistent = true;
    });

    const activeTables = uniqueTables.filter(
      (t) => t.status !== 'CLOSED' && t.show_on_tv !== false
    );

    const displays: TableDisplay[] = [];

    // Use prefetched data from compound query when available (0 extra AppSync calls),
    // otherwise fall back to separate GSI queries (2 calls)
    const { countsMap, allWaitlists } = await getAllTableCountsForClubDay(
      activeClubDay?.id || '', undefined, prefetchedData
    );

    // Build playerWaitlistMap for cross-table lookups
    const playerWaitlistMap = new Map<string, Set<string>>();
    for (const wl of allWaitlists) {
      if (!playerWaitlistMap.has(wl.player_id)) {
        playerWaitlistMap.set(wl.player_id, new Set());
      }
      playerWaitlistMap.get(wl.player_id)!.add(wl.table_id);
    }

    for (const table of activeTables) {
      const counts = countsMap.get(table.id) || { seatedCount: 0, waitlistCount: 0, seatedPlayers: [], waitlistPlayers: [] };
      const seatsFilled = counts.seatedCount;
      const waitlistCount = counts.waitlistCount;

      // Count players seated here who are waiting at another table (uses pre-fetched data, no extra queries)
      let playersWaitingElsewhere = 0;
      for (const seat of counts.seatedPlayers) {
        const waitlistTableIds = playerWaitlistMap.get(seat.player_id);
        if (waitlistTableIds) {
          // Check if they're on a waitlist for a DIFFERENT table
          for (const wlTableId of waitlistTableIds) {
            if (wlTableId !== table.id) {
              playersWaitingElsewhere++;
              break;
            }
          }
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

    // Add pre-sign up persistent tables (without api_table_id) from localStorage
    const persistentOnly = validPts.filter(pt => !pt.api_table_id);
    for (const pt of persistentOnly) {
      const wl = getPersistentWaitlist(pt.id);
      const syntheticTable: PokerTable = {
        id: pt.id,
        club_day_id: activeClubDay?.id || '',
        table_number: pt.table_number,
        game_type: pt.game_type,
        stakes_text: pt.stakes_text,
        seats_total: pt.seats_total,
        bomb_pot_count: pt.bomb_pot_count,
        lockout_count: pt.lockout_count || 0,
        buy_in_limits: pt.buy_in_limits || '',
        show_on_tv: pt.show_on_tv ?? true,
        status: pt.status || 'OPEN',
        created_at: pt.created_at,
        is_persistent: true,
      };
      if (syntheticTable.show_on_tv === false) continue;
      // Convert persistent waitlist entries to TableWaitlist shape for display
      const syntheticWaitlist: TableWaitlist[] = wl.map(w => ({
        id: w.id,
        club_day_id: activeClubDay?.id || '',
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
    <div className={`tv-page${isCasting ? ' casting' : ''}`}>
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
            <span className="tv-time">
              {currentTime.getHours() % 12 || 12}:{currentTime.getMinutes().toString().padStart(2, '0')}
              <span className="tv-time-ampm">{currentTime.getHours() < 12 ? 'AM' : 'PM'}</span>
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
          for (const d of tableDisplays) {
            if (!d.table.is_persistent) seen.add(`${d.table.game_type || 'Other'}||${d.table.stakes_text || ''}`);
          }
          // Also count persistent groups
          const persistentSeen = new Set<string>();
          for (const d of tableDisplays) {
            if (d.table.is_persistent) persistentSeen.add(`${d.table.game_type || 'Other'}||${d.table.stakes_text || ''}`);
          }
          return Math.max(1, seen.size + persistentSeen.size);
        })()}, 1fr)`
      }}>
        {(() => {
          // Group tables by game type + stakes (regular tables only)
          const groups = new Map<string, { gameType: string; stakes: string; displays: TableDisplay[] }>();
          for (const display of tableDisplays) {
            if (display.table.is_persistent) continue;
            const gameType = display.table.game_type || 'Other';
            const stakes = display.table.stakes_text || '';
            const groupKey = `${gameType}||${stakes}`;
            if (!groups.has(groupKey)) {
              groups.set(groupKey, { gameType, stakes, displays: [] });
            }
            groups.get(groupKey)!.displays.push(display);
          }

          // Sort groups: 1/2 stakes first, then by game type priority
          const gameTypeOrder: Record<string, number> = {
            'NLH': 1, 'PLO': 2, 'BigO': 3, 'PLO5': 4, 'Limit': 5, 'Mixed': 6, 'Other': 99
          };
          const sortedGroups = Array.from(groups.values()).sort((a, b) => {
            const orderA = gameTypeOrder[a.gameType] || 50;
            const orderB = gameTypeOrder[b.gameType] || 50;
            if (orderA !== orderB) return orderA - orderB;
            // Within same game type, prioritize 1/2 stakes
            const aIs12 = a.stakes.includes('1/2');
            const bIs12 = b.stakes.includes('1/2');
            if (aIs12 && !bIs12) return -1;
            if (!aIs12 && bIs12) return 1;
            return a.stakes.localeCompare(b.stakes);
          });

          // Also group persistent (pre-sign up) tables
          const persistentGroups = new Map<string, { gameType: string; stakes: string; displays: TableDisplay[] }>();
          for (const display of tableDisplays) {
            if (!display.table.is_persistent) continue;
            const pGameType = display.table.game_type || 'Other';
            const pStakes = display.table.stakes_text || '';
            const pGroupKey = `presign||${pGameType}||${pStakes}`;
            if (!persistentGroups.has(pGroupKey)) {
              persistentGroups.set(pGroupKey, { gameType: pGameType, stakes: pStakes, displays: [] });
            }
            persistentGroups.get(pGroupKey)!.displays.push(display);
          }
          const sortedPersistentGroups = Array.from(persistentGroups.values()).sort((a, b) => {
            const orderA = gameTypeOrder[a.gameType] || 50;
            const orderB = gameTypeOrder[b.gameType] || 50;
            if (orderA !== orderB) return orderA - orderB;
            return a.stakes.localeCompare(b.stakes);
          });

          const regularColumns = sortedGroups.map(({ gameType, stakes, displays }) => {
            const cleanStakes = stakes.replace(/No Limit\s*/gi, '').trim();
            const headerLabel = cleanStakes ? `${gameType} — ${cleanStakes}` : gameType;

            // Build seated player IDs ONLY for this game type + stakes group
            // A player is only TC if seated at a table of the SAME game type, not a different game
            const groupSeatedPlayerIds = new Set<string>();
            for (const d of displays) {
              for (const seat of d.seatedPlayers) {
                groupSeatedPlayerIds.add(seat.player_id);
              }
            }

            // Aggregate unique waitlisted players across all tables in this group
            // Sort by added_at for consistent ordering across all merged views
            const allWaitlistEntries: typeof displays[0]['waitlistPlayers'] = [];
            for (const d of displays) {
              for (const wl of d.waitlistPlayers) {
                if (!wl.called_in) allWaitlistEntries.push(wl);
              }
            }
            // Sort to prioritize TC players: TCs first (by added_at), then regular players (by added_at)
            allWaitlistEntries.sort((a, b) => {
              const aIsTC = groupSeatedPlayerIds.has(a.player_id);
              const bIsTC = groupSeatedPlayerIds.has(b.player_id);
              
              // TC players come first
              if (aIsTC && !bIsTC) return -1;
              if (!aIsTC && bIsTC) return 1;
              
              // Within same group, sort by added_at (oldest first)
              return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
            });
            const seenPlayerIds = new Set<string>();
            const groupWaitlist: { id: string; name: string; playerId: string }[] = [];
            for (const wl of allWaitlistEntries) {
              if (!seenPlayerIds.has(wl.player_id)) {
                seenPlayerIds.add(wl.player_id);
                groupWaitlist.push({
                  id: wl.player_id,
                  name: wl.player?.nick || wl.player?.name || 'Unknown',
                  playerId: wl.player_id,
                });
              }
            }

            // TC detection: player is on waitlist AND seated at a table in THIS SAME game type group
            // Being seated at NLH while on PLO waitlist is NOT a TC — it's a multi-game player
            const tcPlayerIds = new Set<string>();
            for (const wl of allWaitlistEntries) {
              if (groupSeatedPlayerIds.has(wl.player_id)) {
                tcPlayerIds.add(wl.player_id);
              }
            }

            // Aggregate total seated / total seats for this group
            const totalSeated = displays.reduce((sum, d) => sum + d.seatsFilled, 0);
            const totalSeats = displays.reduce((sum, d) => sum + (d.table.seats_total || 20), 0);
            const buyInLimits = displays.find(d => d.table.buy_in_limits)?.table.buy_in_limits || '';

            return (
              <div key={`${gameType}||${stakes}`} className="tv-column">
                <div className="tv-column-header">
                  <h2 className="tv-column-title">
                    <span className="tv-column-game">{gameType}</span>
                    {cleanStakes && <span className="tv-column-stakes">{cleanStakes}{totalSeated === 0 && <span className="tv-interest-inline"> - Interest</span>}</span>}
                  </h2>
                  {buyInLimits && (
                    <div className="tv-column-buyin">Buy-in: {buyInLimits}</div>
                  )}
                  <div className="tv-column-stats">
                    <span className="tv-column-stat">{displays.length} Table{displays.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                <div className="tv-column-body">
                  {/* Table info summary */}
                  <div className="tv-column-table-summary">
                    {displays.map((d) => (
                      <div key={d.table.id} className="tv-summary-table-row">
                        <span className="tv-summary-table-num">Table {d.table.table_number}</span>
                        <span className="tv-summary-table-seats">{d.seatsFilled} Player{d.seatsFilled !== 1 ? 's' : ''}</span>
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
                          const cols: { id: string; name: string; playerId: string }[][] = [];
                          for (let i = 0; i < groupWaitlist.length; i += 10) {
                            cols.push(groupWaitlist.slice(i, i + 10));
                          }
                          return cols.map((col, ci) => (
                            <div key={ci} className="tv-waitlist-col">
                              {col.map((p) => (
                                <span key={p.id} className={`tv-column-waitlist-name${tcPlayerIds.has(p.playerId) ? ' tv-tc-player' : ''}`}>
                                  {tcPlayerIds.has(p.playerId) && <span className="tv-tc-badge">TC</span>}
                                  {p.name}
                                </span>
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

          // Render pre-sign up persistent table columns
          const persistentColumns = sortedPersistentGroups.map(({ gameType, stakes, displays }) => {
            const cleanStakes = stakes.replace(/No Limit\s*/gi, '').trim();
            const headerLabel = cleanStakes ? `${gameType} — ${cleanStakes}` : gameType;
            const buyInLimits = displays.find(d => d.table.buy_in_limits)?.table.buy_in_limits || '';

            // Aggregate waitlist from persistent tables
            const groupWaitlist: { id: string; name: string; playerId: string }[] = [];
            const seenIds = new Set<string>();
            for (const d of displays) {
              for (const wl of d.waitlistPlayers) {
                if (!seenIds.has(wl.player_id)) {
                  seenIds.add(wl.player_id);
                  groupWaitlist.push({
                    id: wl.player_id,
                    name: wl.player?.nick || wl.player?.name || 'Unknown',
                    playerId: wl.player_id,
                  });
                }
              }
            }

            return (
              <div key={`presign-${gameType}||${stakes}`} className="tv-column tv-column-presign">
                <div className="tv-column-header tv-column-header-presign">
                  <div className="tv-presign-label">PRE-SIGN UP</div>
                  <h2 className="tv-column-title">
                    <span className="tv-column-game">{gameType}</span>
                    {cleanStakes && <span className="tv-column-stakes">{cleanStakes}</span>}
                  </h2>
                  {buyInLimits && (
                    <div className="tv-column-buyin">Buy-in: {buyInLimits}</div>
                  )}
                  <div className="tv-column-stats">
                    <span className="tv-column-stat">{displays.length} Table{displays.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                <div className="tv-column-body">
                  <div className="tv-column-table-summary">
                    {displays.map((d) => (
                      <div key={d.table.id} className="tv-summary-table-row">
                        <span className="tv-summary-table-num">Table {d.table.table_number}</span>
                        <span className="tv-summary-table-seats">0 Players</span>
                      </div>
                    ))}
                  </div>

                  <div className="tv-column-waitlist">
                    <div className="tv-column-waitlist-header">
                      Signed Up <span className="tv-column-waitlist-count">{groupWaitlist.length}</span>
                    </div>
                    {groupWaitlist.length > 0 ? (
                      <div className="tv-column-waitlist-names">
                        {(() => {
                          const cols: { id: string; name: string; playerId: string }[][] = [];
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
                      <div className="tv-column-waitlist-empty">No one signed up</div>
                    )}
                  </div>
                </div>
              </div>
            );
          });

          return [...regularColumns, ...persistentColumns];
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
      
      {/* Off-screen cast button - accessible via keyboard shortcut */}
      {cast.isAvailable && (
        <div className="tv-offscreen-controls">
          {cast.isConnected ? (
            <button 
              className="tv-cast-btn tv-cast-btn-connected"
              onClick={cast.stopCast}
              title={`Connected to ${cast.deviceName}. Press Ctrl+Shift+C to disconnect.`}
            >
              📺 {cast.deviceName}
            </button>
          ) : (
            <button 
              className="tv-cast-btn"
              onClick={cast.requestCast}
              title="Press Ctrl+Shift+C to cast to TV"
            >
              📡 Cast
            </button>
          )}
        </div>
      )}
    </div>
  );
}

