import { useState, useEffect } from 'react';
import { seatPlayer } from '../lib/api';
import { showToast } from './Toast';
import type { PokerTable } from '../types';
import './ReseatPanel.css';

interface ReseatPanelProps {
  tables: PokerTable[];
  clubDayId: string;
  adminUser: string;
  onRefresh: () => void;
}

interface RecentRemoval {
  playerId: string;
  playerNick: string;
  tableId: string;
  tableNumber: number;
  removedAt?: number;
  bustedOutAt?: number;
}

export default function ReseatPanel({
  tables,
  clubDayId,
  adminUser: _adminUser,
  onRefresh,
}: ReseatPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [recentRemovals, setRecentRemovals] = useState<RecentRemoval[]>([]);
  const [reseatingPlayerId, setReseatingPlayerId] = useState<string | null>(null);

  useEffect(() => {
    const loadRecentRemovals = () => {
      try {
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
        
        const bustOuts: RecentRemoval[] = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]')
          .filter((b: any) => b.bustedOutAt > thirtyMinutesAgo)
          .map((b: any) => ({
            playerId: b.playerId,
            playerNick: b.playerNick,
            tableId: b.tableId,
            tableNumber: b.tableNumber,
            bustedOutAt: b.bustedOutAt,
          }));

        const removals: RecentRemoval[] = JSON.parse(localStorage.getItem('recent-removals') || '[]')
          .filter((r: any) => r.removedAt > thirtyMinutesAgo)
          .map((r: any) => ({
            playerId: r.playerId,
            playerNick: r.playerNick,
            tableId: r.tableId,
            tableNumber: r.tableNumber,
            removedAt: r.removedAt,
          }));

        // Combine and deduplicate (prefer bust outs if both exist)
        const combined = [...bustOuts, ...removals];
        const unique = combined.reduce((acc, curr) => {
          if (!acc.find(r => r.playerId === curr.playerId)) {
            acc.push(curr);
          }
          return acc;
        }, [] as RecentRemoval[]);

        // Sort by most recent
        unique.sort((a, b) => {
          const timeA = a.bustedOutAt || a.removedAt || 0;
          const timeB = b.bustedOutAt || b.removedAt || 0;
          return timeB - timeA;
        });

        setRecentRemovals(unique);
      } catch (error) {
        console.error('Failed to load recent removals:', error);
        setRecentRemovals([]);
      }
    };

    loadRecentRemovals();
    const interval = setInterval(loadRecentRemovals, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleReseat = async (removal: RecentRemoval, targetTableId: string) => {
    if (reseatingPlayerId) return;

    setReseatingPlayerId(removal.playerId);
    try {
      await seatPlayer(targetTableId, removal.playerId, clubDayId);
      
      // Remove from recent removals
      const updated = recentRemovals.filter(r => r.playerId !== removal.playerId);
      setRecentRemovals(updated);
      
      // Update localStorage
      const bustOuts = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]')
        .filter((b: any) => b.playerId !== removal.playerId);
      localStorage.setItem('recent-bust-outs', JSON.stringify(bustOuts));
      
      const removals = JSON.parse(localStorage.getItem('recent-removals') || '[]')
        .filter((r: any) => r.playerId !== removal.playerId);
      localStorage.setItem('recent-removals', JSON.stringify(removals));

      const targetTable = tables.find(t => t.id === targetTableId);
      showToast(`Re-seated ${removal.playerNick} at Table ${targetTable?.table_number || '?'}`, 'success');
      onRefresh();
    } catch (error: any) {
      showToast(error.message || 'Failed to re-seat player', 'error');
    } finally {
      setReseatingPlayerId(null);
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes === 1) return '1 minute ago';
    return `${minutes} minutes ago`;
  };

  if (recentRemovals.length === 0) {
    return null;
  }

  return (
    <div className={`reseat-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="reseat-panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="reseat-panel-title">
          <span className={`collapse-arrow ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
          <h3>Recently Removed/Busted Out</h3>
          <span className="reseat-count-badge">{recentRemovals.length}</span>
        </div>
      </div>

      {!isCollapsed && (
        <div className="reseat-panel-content">
          <div className="reseat-panel-list">
            {recentRemovals.map((removal) => {
              const availableTables = tables.filter(
                t => t.status !== 'CLOSED' && t.id !== removal.tableId
              );

              return (
                <div key={removal.playerId} className="reseat-panel-item">
                  <div className="reseat-item-info">
                    <div className="reseat-item-main">
                      <span className="reseat-player-name">{removal.playerNick}</span>
                      {removal.bustedOutAt && (
                        <span className="reseat-type-badge bust-out">Busted Out</span>
                      )}
                      {removal.removedAt && !removal.bustedOutAt && (
                        <span className="reseat-type-badge removed">Removed</span>
                      )}
                    </div>
                    <div className="reseat-item-details">
                      <span className="reseat-table-info">
                        Was at Table {removal.tableNumber}
                      </span>
                      <span className="reseat-time-ago">
                        {formatTimeAgo(removal.bustedOutAt || removal.removedAt || Date.now())}
                      </span>
                    </div>
                  </div>
                  <div className="reseat-item-actions">
                    <select
                      className="reseat-table-select"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleReseat(removal, e.target.value);
                        }
                      }}
                      disabled={reseatingPlayerId === removal.playerId}
                      value=""
                    >
                      <option value="">Re-seat to...</option>
                      {availableTables.map((table) => (
                        <option key={table.id} value={table.id}>
                          Table {table.table_number} ({table.game_type})
                        </option>
                      ))}
                    </select>
                    {reseatingPlayerId === removal.playerId && (
                      <span className="reseat-loading">Seating...</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
