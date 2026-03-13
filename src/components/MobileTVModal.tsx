import { useEffect, useState, useRef } from 'react';
import { getActiveClubDay, getTablesForClubDay } from '../lib/api';
import { getTableCounts } from '../lib/tableCounts';
import { generateClient } from '../lib/graphql-client';
import { initializeLocalPlayers, startPlayerSyncPolling } from '../lib/localStoragePlayers';
import { log, logWarn, logError } from '../lib/logger';
import type { ClubDay, PokerTable, TableSeat, TableWaitlist } from '../types';
import Logo from './Logo';
import './MobileTVModal.css';

const client = generateClient();

interface TableDisplay {
  table: PokerTable;
  seatsFilled: number;
  waitlistCount: number;
  playersWaitingElsewhere: number;
  seatedPlayers: TableSeat[];
  waitlistPlayers: TableWaitlist[];
}

interface MobileTVModalProps {
  clubDayId: string;
  onClose: () => void;
}

export default function MobileTVModal({ clubDayId, onClose }: MobileTVModalProps) {
  const [clubDay, setClubDay] = useState<ClubDay | null>(null);
  const [tableDisplays, setTableDisplays] = useState<TableDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const isLoadingRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);

  useEffect(() => {
    // Initialize localStorage players system
    initializeLocalPlayers();
    
    // Start syncing players from admin device
    const stopPlayerSync = startPlayerSyncPolling(clubDayId, (players) => {
      log(`📡 Mobile TV: Synced ${players.length} players from admin`);
    }, 10000); // Poll every 10 seconds
    
    loadData();
    
    return () => {
      stopPlayerSync();
    };
  }, [clubDayId]);

  useEffect(() => {
    if (!clubDay) return;

    const pollInterval = setInterval(() => {
      if (document.hidden) return;
      loadData();
    }, 10000); // 10s polling

    return () => clearInterval(pollInterval);
  }, [clubDay]);

  useEffect(() => {
    // Update clock every second
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(clockInterval);
  }, []);

  // Debounced refresh — coalesces rapid-fire events into one loadData call
  const debouncedRefresh = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      loadData();
    }, 500);
  };

  useEffect(() => {
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
    }, 3000); // 3s

    let adminChannel: BroadcastChannel | null = null;
    let tvChannel: BroadcastChannel | null = null;

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

    window.addEventListener('storage', handleStorage);

    return () => {
      if (adminChannel) {
        adminChannel.close();
      }
      if (tvChannel) {
        tvChannel.close();
      }
      window.removeEventListener('storage', handleStorage);
      clearInterval(pollInterval);
    };
  }, []);

  const loadData = async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      // Get active club day
      const activeDay = await getActiveClubDay();
      if (!activeDay) {
        setLoading(false);
        return;
      }
      setClubDay(activeDay);

      // Get all tables for the club day and deduplicate by table_number
      const allTables = await getTablesForClubDay(activeDay.id);
      log('MobileTV: All tables fetched:', allTables.map(t => `Table ${t.table_number} (${t.status})`));

      const tables = Array.from(
        new Map(allTables.map((table) => [table.table_number, table])).values()
      );
      log('MobileTV: Deduplicated tables:', tables.map(t => `Table ${t.table_number} (${t.status})`));

      const displays: TableDisplay[] = [];

      for (const table of tables) {
        // Use centralized counting function - SINGLE SOURCE OF TRUTH
        // CRITICAL: Pass clubDayId to prevent counting players from old club days
        const counts = await getTableCounts(table.id, clubDayId);
        const seatsFilled = counts.seatedCount;
        const waitlistCount = counts.waitlistCount;

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

      // Sort by table number
      displays.sort((a, b) => a.table.table_number - b.table.table_number);

      log('MobileTV: Final displays:', displays.map(d => `Table ${d.table.table_number}`));

      setTableDisplays(displays);
    } catch (error) {
      logError('Error loading mobile TV data:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content mobile-tv-modal" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-tv-loading">
            <div className="mobile-tv-spinner"></div>
            <h3>Loading Tables...</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content mobile-tv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-tv-header">
          <button className="mobile-tv-close" onClick={onClose}>×</button>
          <div className="mobile-tv-logo" style={{ left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <Logo />
          </div>
          <div className="mobile-tv-time">
            {currentTime.getHours() % 12 || 12}:{currentTime.getMinutes().toString().padStart(2, '0')}
            <span className="mobile-tv-seconds">:{currentTime.getSeconds().toString().padStart(2, '0')}</span>
          </div>
        </div>

        <div className="mobile-tv-content">
          {tableDisplays.filter(d => d.seatsFilled > 0 || d.waitlistCount > 0).length === 0 ? (
            <div className="mobile-tv-empty">
              <h3>No Active Games</h3>
              <p>Check back later!</p>
            </div>
          ) : (
            <div className="mobile-tv-grid">
              {tableDisplays
                .filter(display => display.seatsFilled > 0 || display.waitlistCount > 0)
                .map((display) => (
                <MobileTVTableCard key={display.table.id} display={display} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileTVTableCard({ display }: { display: TableDisplay }) {
  const { table, seatsFilled, waitlistCount, playersWaitingElsewhere, seatedPlayers, waitlistPlayers } = display;

  const getGameLabel = (gameType: string, stakesText: string) => {
    if (stakesText.toLowerCase().includes('plo5')) return 'PLO5';
    if (gameType === 'NLH') return 'NL';
    if (gameType === 'BigO') return 'Big O';
    return gameType;
  };

  // Use custom buy-in limits if set, otherwise fall back to hardcoded defaults
  const getBuyInRange = (table: PokerTable) => {
    // Always prioritize custom buy-in limits if set
    if (table.buy_in_limits && table.buy_in_limits.trim()) {
      return table.buy_in_limits.trim();
    }

    // Fallback to hardcoded values based on stakes text
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
  const bombPotCount = table.bomb_pot_count || 1;

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

      <div className="mobile-tv-player-lists">
        <div className="mobile-tv-player-section mobile-tv-seated-section">
          <div className="mobile-tv-section-header">
            <span className="mobile-tv-section-title">Seated</span>
            <span className="mobile-tv-section-count">{seatsFilled}/9</span>
          </div>
          <ul className="mobile-tv-player-names">
            {seatedPlayers.length > 0 ? (
              seatedPlayers.map((seat) => (
                <li key={seat.id} className="mobile-tv-player-name">
                  {seat.player?.nick || seat.player?.name || 'Unknown'}
                </li>
              ))
            ) : (
              <li className="mobile-tv-no-players">No players</li>
            )}
          </ul>
        </div>
        {waitlistPlayers.length > 0 && (
          <div className="mobile-tv-player-section mobile-tv-waitlist-section">
            <div className="mobile-tv-section-header">
              <span className="mobile-tv-section-title">Waitlist</span>
              <span className="mobile-tv-section-count">{waitlistCount}</span>
            </div>
            <ul className="mobile-tv-player-names">
              {waitlistPlayers.map((wl) => (
                <li key={wl.id} className="mobile-tv-player-name mobile-tv-waiting-player">
                  {wl.player?.nick || wl.player?.name || 'Unknown'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {playersWaitingElsewhere > 0 && (
        <div className="mobile-tv-waiting-elsewhere">
          {playersWaitingElsewhere} seated player{playersWaitingElsewhere !== 1 ? 's' : ''} waiting elsewhere
        </div>
      )}

      {bombPotCount > 0 && (
        <div className="mobile-tv-bomb-pots">
          💣 {bombPotCount} Bomb Pot{bombPotCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}