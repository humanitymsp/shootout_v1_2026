import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { seatPlayer, removePlayerFromSeat, addPlayerToWaitlist, removePlayerFromWaitlist } from '../lib/api';
import { getTableCounts } from '../lib/tableCounts';
import { initializeLocalPlayers, startPlayerSyncPolling } from '../lib/localStoragePlayers';
import { showToast } from './Toast';
import { logError, log } from '../lib/logger';
import type { PokerTable, TableSeat, TableWaitlist } from '../types';
import Logo from './Logo';
import './TabletManagementPage.css';

interface TabletManagementPageProps {
  clubDayId: string;
  tables: PokerTable[];
  adminUser: string;
  onClose: () => void;
  onRefresh: () => void;
}

export default function TabletManagementPage({
  clubDayId,
  tables,
  adminUser,
  onClose,
  onRefresh,
}: TabletManagementPageProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<{ player: TableSeat | TableWaitlist; sourceTableId: string; isFromWaitlist: boolean } | null>(null);
  const [tableData, setTableData] = useState<Map<string, { seated: TableSeat[]; waitlist: TableWaitlist[] }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [movingPlayer, setMovingPlayer] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [gridColumns, setGridColumns] = useState(2);
  const lastTableIdsRef = useRef<string>('');
  const isLoadingRef = useRef(false);
  const tablesRef = useRef<PokerTable[]>(tables);
  const gridRef = useRef<HTMLDivElement>(null);

  // Initialize localStorage players and start syncing from admin
  useEffect(() => {
    initializeLocalPlayers();
    
    // Start syncing players from admin device
    const stopPlayerSync = startPlayerSyncPolling(clubDayId, (players) => {
      log(`📡 Tablet: Synced ${players.length} players from admin`);
    }, 10000); // Poll every 10 seconds
    
    return () => {
      stopPlayerSync();
    };
  }, [clubDayId]);

  // Update ref when tables change
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // Create stable table IDs string for comparison
  const tableIdsString = useMemo(() => {
    return tables.filter(t => t.status !== 'CLOSED').map(t => t.id).sort().join(',');
  }, [tables]);

  // Load function - uses tables from ref to avoid dependency issues
  const loadAllTableData = useCallback(async () => {
    // Prevent concurrent loads
    if (isLoadingRef.current) {
      return;
    }
    
    isLoadingRef.current = true;
    setLoading(true);
    const data = new Map<string, { seated: TableSeat[]; waitlist: TableWaitlist[] }>();
    
    // Get current tables from ref
    const currentTables = tablesRef.current.filter(t => t.status !== 'CLOSED');
    for (const table of currentTables) {
      try {
        // Use centralized counting function - SINGLE SOURCE OF TRUTH
        // CRITICAL: Pass clubDayId to prevent counting players from old club days
        const counts = await getTableCounts(table.id, clubDayId);
        data.set(table.id, { 
          seated: counts.seatedPlayers, 
          waitlist: counts.waitlistPlayers 
        });
      } catch (error) {
        logError(`Error loading data for table ${table.id}:`, error);
        data.set(table.id, { seated: [], waitlist: [] });
      }
    }
    
    setTableData(data);
    setLoading(false);
    isLoadingRef.current = false;
  }, []); // No dependencies - uses ref

  // Load player data for all tables - only when table structure actually changes
  useEffect(() => {
    // Only reload if table IDs actually changed (not just array reference)
    if (tableIdsString !== lastTableIdsRef.current) {
      lastTableIdsRef.current = tableIdsString;
      loadAllTableData();
    }
  }, [tableIdsString, clubDayId, loadAllTableData]);

  // Listen for real-time updates via broadcast channels
  useEffect(() => {
    const handleBroadcastMessage = (event: MessageEvent) => {
      if (event.data?.type === 'player-update' || event.data?.type === 'table-update') {
        // Debounce rapid updates
        setTimeout(() => {
          if (!isLoadingRef.current) {
            loadAllTableData();
          }
        }, 500);
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'player-updated' || e.key === 'table-updated') {
        setTimeout(() => {
          if (!isLoadingRef.current) {
            loadAllTableData();
          }
        }, 500);
      }
    };

    let broadcastChannel: BroadcastChannel | null = null;
    try {
      broadcastChannel = new BroadcastChannel('admin-updates');
      broadcastChannel.addEventListener('message', handleBroadcastMessage);
    } catch (error) {
      // BroadcastChannel not supported
    }

    window.addEventListener('storage', handleStorageEvent);

    return () => {
      if (broadcastChannel) {
        broadcastChannel.removeEventListener('message', handleBroadcastMessage);
        broadcastChannel.close();
      }
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [loadAllTableData]);

  // Update clock every second
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(clockInterval);
  }, []);

  // Detect grid columns to calculate placeholders needed
  useEffect(() => {
    const updateGridColumns = () => {
      if (!gridRef.current) return;
      
      const grid = gridRef.current;
      const computedStyle = window.getComputedStyle(grid);
      const gridTemplateColumns = computedStyle.gridTemplateColumns;
      
      // Count the number of columns
      const columns = gridTemplateColumns.split(' ').filter(col => col !== '').length;
      if (columns > 0) {
        setGridColumns(columns);
      }
    };

    // Update on mount and resize
    updateGridColumns();
    window.addEventListener('resize', updateGridColumns);
    
    // Also check after a short delay to ensure grid is rendered
    const timeout = setTimeout(updateGridColumns, 100);

    return () => {
      window.removeEventListener('resize', updateGridColumns);
      clearTimeout(timeout);
    };
  }, [tableData.size]); // Re-run when table count changes

  // Expose refresh function for manual refresh button
  const handleManualRefresh = () => {
    if (!isLoadingRef.current) {
      loadAllTableData();
    }
  };

  const handlePlayerSelect = (player: TableSeat | TableWaitlist, tableId: string, isFromWaitlist: boolean) => {
    if (selectedPlayer?.player.player_id === player.player_id && selectedPlayer.sourceTableId === tableId) {
      // Deselect if clicking the same player
      setSelectedPlayer(null);
    } else {
      setSelectedPlayer({ player, sourceTableId: tableId, isFromWaitlist });
    }
  };

  const handleTableSelect = async (targetTableId: string) => {
    if (!selectedPlayer) return;
    if (selectedPlayer.sourceTableId === targetTableId) {
      showToast('Player is already at this table', 'error');
      return;
    }

    const targetTable = tables.find(t => t.id === targetTableId);
    if (!targetTable) return;

    // Check if table is full
    const targetData = tableData.get(targetTableId);
    const seatsFilled = targetData?.seated.length || 0;
    if (seatsFilled >= (targetTable.seats_total ?? 9)) {
      showToast(`Table ${targetTable.table_number} is full`, 'error');
      return;
    }

    setMovingPlayer(selectedPlayer.player.player_id);
    
    try {
      const playerId = selectedPlayer.player.player_id;
      
      // Remove from source location
      if (selectedPlayer.isFromWaitlist) {
        await removePlayerFromWaitlist(selectedPlayer.player.id, adminUser);
      } else {
        await removePlayerFromSeat(selectedPlayer.player.id, selectedPlayer.sourceTableId, adminUser);
      }

      // Add to target table
      await seatPlayer(targetTableId, playerId, clubDayId);

      showToast(`Moved ${selectedPlayer.player.player?.nick || 'player'} to Table ${targetTable.table_number}`, 'success');
      
      // Refresh data
      await loadAllTableData();
      onRefresh();
      setSelectedPlayer(null);
    } catch (error: any) {
      logError('Error moving player:', error);
      showToast(error.message || 'Failed to move player', 'error');
    } finally {
      setMovingPlayer(null);
    }
  };

  const handleMoveToWaitlist = async (targetTableId: string) => {
    if (!selectedPlayer) return;
    if (selectedPlayer.isFromWaitlist && selectedPlayer.sourceTableId === targetTableId) {
      showToast('Player is already waitlisted at this table', 'error');
      return;
    }

    const targetTable = tables.find(t => t.id === targetTableId);
    if (!targetTable) return;

    setMovingPlayer(selectedPlayer.player.player_id);
    
    try {
      const playerId = selectedPlayer.player.player_id;
      
      // Remove from source location
      if (selectedPlayer.isFromWaitlist) {
        await removePlayerFromWaitlist(selectedPlayer.player.id, adminUser);
      } else {
        await removePlayerFromSeat(selectedPlayer.player.id, selectedPlayer.sourceTableId, adminUser);
      }

      // Add to target waitlist
      await addPlayerToWaitlist(targetTableId, playerId, clubDayId, adminUser);

      showToast(`Moved ${selectedPlayer.player.player?.nick || 'player'} to waitlist at Table ${targetTable.table_number}`, 'success');
      
      // Refresh data
      await loadAllTableData();
      onRefresh();
      setSelectedPlayer(null);
    } catch (error: any) {
      logError('Error moving player to waitlist:', error);
      showToast(error.message || 'Failed to move player', 'error');
    } finally {
      setMovingPlayer(null);
    }
  };

  if (loading) {
    return (
      <div className="tablet-management-page">
        <div className="tablet-loading">
          <div className="tablet-spinner"></div>
          <p>Loading tables...</p>
        </div>
      </div>
    );
  }

  const activeTables = tables.filter(t => t.status !== 'CLOSED').sort((a, b) => a.table_number - b.table_number);

  return (
    <div className="tablet-management-page">
      <div className="tablet-logo-section">
        <Logo />
      </div>
      <div className="tablet-header">
        <div className="tablet-header-left">
          <div className="tablet-date-time">
            <div className="tablet-date">
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            <div className="tablet-time">
              {currentTime.getHours() % 12 || 12}:{currentTime.getMinutes().toString().padStart(2, '0')}
              <span className="tablet-time-period">
                {currentTime.getHours() >= 12 ? 'PM' : 'AM'}
              </span>
            </div>
          </div>
        </div>
        <div className="tablet-header-right">
          <h1>Tablet Management</h1>
          <div className="tablet-header-actions">
            <button 
              className="tablet-refresh-btn" 
              onClick={handleManualRefresh}
              disabled={isLoadingRef.current}
              title="Refresh data"
            >
              Refresh
            </button>
            <button className="tablet-close-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {selectedPlayer && (
        <div className="tablet-selection-banner">
          <div className="selection-info">
            <span className="selection-label">Selected:</span>
            <span className="selection-player">
              {selectedPlayer.player.player?.nick || selectedPlayer.player.player?.name || 'Unknown'}
            </span>
            <span className="selection-location">
              {selectedPlayer.isFromWaitlist ? 'Waitlist' : 'Seated'} at Table {
                tables.find(t => t.id === selectedPlayer.sourceTableId)?.table_number
              }
            </span>
          </div>
          <button 
            className="tablet-clear-selection"
            onClick={() => setSelectedPlayer(null)}
          >
            Clear
          </button>
        </div>
      )}

      <div 
        ref={gridRef}
        className="tablet-tables-grid"
        data-table-count={activeTables.length}
        data-grid-columns={gridColumns}
      >
        {activeTables.map((table) => {
          const data = tableData.get(table.id) || { seated: [], waitlist: [] };
          const seatsFilled = data.seated.length;
          const seatsTotal = table.seats_total ?? 9;
          const isFull = seatsFilled >= seatsTotal;
          const isSelected = selectedPlayer?.sourceTableId === table.id;

          return (
            <div 
              key={table.id} 
              className={`tablet-table-card ${isFull ? 'full' : ''} ${isSelected ? 'selected' : ''}`}
            >
              <div className="tablet-table-header">
                <h2>Table {table.table_number}</h2>
                <div className="tablet-table-stakes">{table.stakes_text}</div>
                <div className="tablet-table-capacity">
                  {seatsFilled}/{seatsTotal} seats
                </div>
              </div>

              {!selectedPlayer ? (
                <>
                  <div className="tablet-seated-section">
                    <h3>Seated ({data.seated.length})</h3>
                    <div className="tablet-players-list">
                      {data.seated.length === 0 ? (
                        <div className="tablet-empty-state">No players seated</div>
                      ) : (
                        data.seated.map((seat) => (
                          <button
                            key={seat.id}
                            className="tablet-player-item seated"
                            onClick={() => handlePlayerSelect(seat, table.id, false)}
                          >
                            {seat.player?.nick || seat.player?.name || 'Unknown'}
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="tablet-waitlist-section">
                    <h3>Waitlist ({data.waitlist.length})</h3>
                    <div className="tablet-players-list">
                      {data.waitlist.length === 0 ? (
                        <div className="tablet-empty-state">No players waiting</div>
                      ) : (
                        data.waitlist.map((wl) => (
                          <button
                            key={wl.id}
                            className="tablet-player-item waitlist"
                            onClick={() => handlePlayerSelect(wl, table.id, true)}
                          >
                            {wl.player?.nick || wl.player?.name || 'Unknown'}
                            {wl.called_in && <span className="tablet-called-in">Called</span>}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="tablet-move-actions">
                  {selectedPlayer.sourceTableId !== table.id && (
                    <>
                      {!isFull && (
                        <button
                          className="tablet-action-btn tablet-move-seat"
                          onClick={() => handleTableSelect(table.id)}
                          disabled={movingPlayer === selectedPlayer.player.player_id}
                        >
                          {movingPlayer === selectedPlayer.player.player_id ? 'Moving...' : `Move Here (${seatsFilled}/${seatsTotal})`}
                        </button>
                      )}
                      <button
                        className="tablet-action-btn tablet-move-waitlist"
                        onClick={() => handleMoveToWaitlist(table.id)}
                        disabled={movingPlayer === selectedPlayer.player.player_id}
                      >
                        {movingPlayer === selectedPlayer.player.player_id ? 'Moving...' : 'Add to Waitlist'}
                      </button>
                    </>
                  )}
                  {selectedPlayer.sourceTableId === table.id && (
                    <div className="tablet-same-table-message">
                      Player is already at this table
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {(() => {
          // Calculate how many placeholders are needed to fill empty spaces
          if (activeTables.length === 0) return null;
          
          const remainder = activeTables.length % gridColumns;
          const placeholdersNeeded = remainder > 0 ? gridColumns - remainder : 0;
          
          return Array.from({ length: placeholdersNeeded }, (_, index) => (
            <div key={`placeholder-${index}`} className="tablet-placeholder-card">
              <div className="tablet-placeholder-content">
                <div className="tablet-placeholder-logo">
                  <Logo />
                </div>
                <p className="tablet-placeholder-text">
                  Waiting for table...
                </p>
              </div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
