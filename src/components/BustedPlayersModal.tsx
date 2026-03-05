import { useState, useEffect, useMemo } from 'react';
import { getBustedPlayersForClubDay, seatPlayer, addPlayerToWaitlist } from '../lib/api';
import { showToast } from './Toast';
import type { PokerTable, TableSeat } from '../types';
import './BustedPlayersModal.css';

interface BustedPlayersModalProps {
  clubDayId: string;
  adminUser: string;
  tables: PokerTable[];
  onClose: () => void;
  onRefresh: () => void;
}

export default function BustedPlayersModal({
  clubDayId,
  adminUser,
  tables,
  onClose,
  onRefresh,
}: BustedPlayersModalProps) {
  const [bustedPlayers, setBustedPlayers] = useState<TableSeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [waitlistTarget, setWaitlistTarget] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [filterGameType, setFilterGameType] = useState('all');

  const activeTables = useMemo(
    () => tables.filter(t => t.status !== 'CLOSED'),
    [tables]
  );

  const gameTypes = useMemo(
    () => [...new Set(activeTables.map(t => t.game_type || 'NLH'))],
    [activeTables]
  );

  // Deduplicate: only show the most recent bust for each player
  const uniqueBustedPlayers = useMemo(() => {
    const seen = new Map<string, TableSeat>();
    for (const seat of bustedPlayers) {
      const existing = seen.get(seat.player_id);
      if (!existing) {
        seen.set(seat.player_id, seat);
      }
    }
    return Array.from(seen.values());
  }, [bustedPlayers]);

  // Filter out players who are currently seated (already re-bought in)
  const [currentlySeatedIds, setCurrentlySeatedIds] = useState<Set<string>>(new Set());

  const filteredPlayers = useMemo(() => {
    let players = uniqueBustedPlayers.filter(p => !currentlySeatedIds.has(p.player_id));
    if (filterGameType !== 'all') {
      players = players.filter(p => {
        const table = tables.find(t => t.id === p.table_id);
        return table?.game_type === filterGameType;
      });
    }
    return players;
  }, [uniqueBustedPlayers, currentlySeatedIds, filterGameType, tables]);

  useEffect(() => {
    loadBustedPlayers();
  }, [clubDayId]);

  const loadBustedPlayers = async () => {
    setLoading(true);
    try {
      const busted = await getBustedPlayersForClubDay(clubDayId);
      setBustedPlayers(busted);

      // Build set of currently seated player IDs to filter out re-bought players
      const seatedIds = new Set<string>();
      for (const table of activeTables) {
        // Check localStorage for seated players per table
        try {
          const key = `table-seated-${table.id}`;
          const stored = localStorage.getItem(key);
          if (stored) {
            const seats = JSON.parse(stored);
            seats.forEach((s: any) => {
              if (s.player_id && !s.left_at) seatedIds.add(s.player_id);
            });
          }
        } catch { /* ignore */ }
      }
      setCurrentlySeatedIds(seatedIds);
    } catch (error) {
      console.error('Failed to load busted players:', error);
      showToast('Failed to load busted players', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBuyBack = async (seat: TableSeat) => {
    const playerName = seat.player?.nick || seat.player?.name || 'Unknown';
    const originalTable = activeTables.find(t => t.id === seat.table_id);

    if (!originalTable) {
      showToast(`Original table no longer exists. Use "Add to Waitlist" instead.`, 'error');
      return;
    }

    setActionInProgress(seat.player_id);
    try {
      await seatPlayer(originalTable.id, seat.player_id, clubDayId);
      showToast(`${playerName} re-seated at Table ${originalTable.table_number}`, 'success');

      // Remove from localStorage bust list
      try {
        const bustOuts = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]')
          .filter((b: any) => b.playerId !== seat.player_id);
        localStorage.setItem('recent-bust-outs', JSON.stringify(bustOuts));
      } catch { /* ignore */ }

      // Add to currently seated so they disappear from list
      setCurrentlySeatedIds(prev => new Set([...prev, seat.player_id]));
      onRefresh();
    } catch (error: any) {
      showToast(error.message || `Failed to re-seat ${playerName}`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAddToWaitlist = async (seat: TableSeat, tableId: string) => {
    const playerName = seat.player?.nick || seat.player?.name || 'Unknown';
    const targetTable = activeTables.find(t => t.id === tableId);

    setActionInProgress(seat.player_id);
    try {
      await addPlayerToWaitlist(tableId, seat.player_id, clubDayId, adminUser);
      showToast(`${playerName} added to waitlist at Table ${targetTable?.table_number || '?'}`, 'success');

      // Remove from localStorage bust list
      try {
        const bustOuts = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]')
          .filter((b: any) => b.playerId !== seat.player_id);
        localStorage.setItem('recent-bust-outs', JSON.stringify(bustOuts));
      } catch { /* ignore */ }

      setCurrentlySeatedIds(prev => new Set([...prev, seat.player_id]));
      setWaitlistTarget(null);
      setSelectedTableId('');
      onRefresh();
    } catch (error: any) {
      showToast(error.message || `Failed to add ${playerName} to waitlist`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAddToAllWaitlists = async (seat: TableSeat, gameType?: string) => {
    const playerName = seat.player?.nick || seat.player?.name || 'Unknown';
    const targetTables = gameType
      ? activeTables.filter(t => t.game_type === gameType)
      : activeTables;

    if (targetTables.length === 0) {
      showToast('No active tables available', 'error');
      return;
    }

    setActionInProgress(seat.player_id);
    let added = 0;
    try {
      for (const table of targetTables) {
        try {
          await addPlayerToWaitlist(table.id, seat.player_id, clubDayId, adminUser);
          added++;
        } catch { /* skip tables where they're already listed */ }
      }
      showToast(`${playerName} added to ${added} waitlist${added !== 1 ? 's' : ''}${gameType ? ` (${gameType})` : ''}`, 'success');

      // Remove from localStorage bust list
      try {
        const bustOuts = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]')
          .filter((b: any) => b.playerId !== seat.player_id);
        localStorage.setItem('recent-bust-outs', JSON.stringify(bustOuts));
      } catch { /* ignore */ }

      setCurrentlySeatedIds(prev => new Set([...prev, seat.player_id]));
      setWaitlistTarget(null);
      onRefresh();
    } catch (error: any) {
      showToast(error.message || `Failed to add ${playerName} to waitlists`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return '';
    const minutes = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  };

  const getTableInfo = (tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return { number: '?', gameType: 'Unknown', stakes: '' };
    return { number: table.table_number, gameType: table.game_type || 'NLH', stakes: table.stakes_text || '' };
  };

  return (
    <div className="busted-modal-overlay" onClick={onClose}>
      <div className="busted-modal" onClick={(e) => e.stopPropagation()}>
        <div className="busted-modal-header">
          <div>
            <h3>Busted Players</h3>
            <p className="busted-modal-subtitle">
              {filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''} busted today
            </p>
          </div>
          <button className="busted-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="busted-modal-controls">
          {gameTypes.length > 1 && (
            <select
              value={filterGameType}
              onChange={(e) => setFilterGameType(e.target.value)}
              className="busted-filter-select"
            >
              <option value="all">All Game Types</option>
              {gameTypes.map(gt => (
                <option key={gt} value={gt}>{gt}</option>
              ))}
            </select>
          )}
          <button
            className="busted-refresh-btn"
            onClick={loadBustedPlayers}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <div className="busted-modal-body">
          {loading ? (
            <div className="busted-empty">Loading busted players...</div>
          ) : filteredPlayers.length === 0 ? (
            <div className="busted-empty">
              {uniqueBustedPlayers.length === 0
                ? 'No busted players today'
                : 'No busted players match the current filter'}
            </div>
          ) : (
            <div className="busted-list">
              {filteredPlayers.map((seat) => {
                const playerName = seat.player?.nick || seat.player?.name || 'Unknown';
                const tableInfo = getTableInfo(seat.table_id);
                const originalTableExists = activeTables.some(t => t.id === seat.table_id);
                const isProcessing = actionInProgress === seat.player_id;
                const showWaitlistPicker = waitlistTarget === seat.player_id;

                return (
                  <div key={`${seat.id}`} className="busted-item">
                    <div className="busted-item-info">
                      <div className="busted-item-main">
                        <span className="busted-player-name">{playerName}</span>
                        <span className="busted-time">{formatTimeAgo(seat.left_at)}</span>
                      </div>
                      <div className="busted-item-details">
                        <span className="busted-table-badge">
                          Table {tableInfo.number} • {tableInfo.gameType} • {tableInfo.stakes}
                        </span>
                      </div>
                    </div>

                    <div className="busted-item-actions">
                      {!showWaitlistPicker ? (
                        <>
                          {originalTableExists && (
                            <button
                              className="busted-action-btn busted-buyback-btn"
                              onClick={() => handleBuyBack(seat)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? '...' : 'Re-seat'}
                            </button>
                          )}
                          <button
                            className="busted-action-btn busted-waitlist-btn"
                            onClick={() => {
                              setWaitlistTarget(seat.player_id);
                              setSelectedTableId('');
                            }}
                            disabled={isProcessing}
                          >
                            Waitlist
                          </button>
                        </>
                      ) : (
                        <div className="busted-waitlist-picker">
                          <select
                            value={selectedTableId}
                            onChange={(e) => setSelectedTableId(e.target.value)}
                            className="busted-table-select"
                          >
                            <option value="">Select table...</option>
                            {activeTables.map(t => (
                              <option key={t.id} value={t.id}>
                                Table {t.table_number} — {t.game_type} {t.stakes_text}
                              </option>
                            ))}
                          </select>
                          <div className="busted-waitlist-actions">
                            <button
                              className="busted-action-btn busted-add-btn"
                              onClick={() => selectedTableId && handleAddToWaitlist(seat, selectedTableId)}
                              disabled={!selectedTableId || isProcessing}
                            >
                              Add
                            </button>
                            {gameTypes.map(gt => (
                              <button
                                key={gt}
                                className="busted-action-btn busted-all-btn"
                                onClick={() => handleAddToAllWaitlists(seat, gt)}
                                disabled={isProcessing}
                                title={`Add to all ${gt} waitlists`}
                              >
                                All {gt}
                              </button>
                            ))}
                            <button
                              className="busted-action-btn busted-cancel-btn"
                              onClick={() => { setWaitlistTarget(null); setSelectedTableId(''); }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
