import { useState, useMemo } from 'react';
import { seatPlayer, seatCalledInPlayer } from '../lib/api';
import type { TableWaitlist, PokerTable } from '../types';
import { showToast } from './Toast';
import DoorFeeModal from './DoorFeeModal';
import './WaitlistPanel.css';

interface WaitlistPanelProps {
  waitlistPlayersMap: Map<string, TableWaitlist[]>;
  tables: PokerTable[];
  clubDayId: string;
  adminUser: string;
  onRefresh: () => void;
  onSeatPlayer: (tableId: string, playerId: string) => void;
}

type SortField = 'table' | 'player' | 'waitTime';

export default function WaitlistPanel({
  waitlistPlayersMap,
  tables,
  clubDayId,
  adminUser,
  onRefresh,
  onSeatPlayer: _onSeatPlayer,
}: WaitlistPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [sortField, setSortField] = useState<SortField>('table');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Collect all waitlisted players with their table info
  const allWaitlistEntries = useMemo(() => {
    const entries: Array<{
      waitlist: TableWaitlist;
      table: PokerTable | null;
      tableNumber: number;
      waitTime: number;
    }> = [];

    waitlistPlayersMap.forEach((waitlist, tableId) => {
      const table = tables.find(t => t.id === tableId);
      waitlist.forEach((wl) => {
        // Calculate wait time (time since added_at or created_at)
        const waitlistedAt = wl.added_at 
          ? new Date(wl.added_at).getTime()
          : wl.created_at 
          ? new Date(wl.created_at).getTime()
          : Date.now();
        const waitTime = Date.now() - waitlistedAt;

        entries.push({
          waitlist: wl,
          table: table || null,
          tableNumber: table?.table_number || 999,
          waitTime,
        });
      });
    });

    return entries;
  }, [waitlistPlayersMap, tables]);

  // Sort entries
  const sortedEntries = useMemo(() => {
    const sorted = [...allWaitlistEntries].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'table':
          comparison = a.tableNumber - b.tableNumber;
          break;
        case 'player':
          const nameA = a.waitlist.player?.nick || a.waitlist.player?.name || 'Unknown';
          const nameB = b.waitlist.player?.nick || b.waitlist.player?.name || 'Unknown';
          comparison = nameA.localeCompare(nameB);
          break;
        case 'waitTime':
          comparison = a.waitTime - b.waitTime;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [allWaitlistEntries, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const [calledInModal, setCalledInModal] = useState<{
    entry: TableWaitlist;
    tableId: string;
    playerName: string;
  } | null>(null);

  const handleSeatPlayer = async (waitlist: TableWaitlist, tableId: string) => {
    try {
      if (waitlist.called_in) {
        // Called-in player needs door fee
        setCalledInModal({ entry: waitlist, tableId, playerName: waitlist.player?.nick || waitlist.player?.name || 'Unknown' });
      } else {
        // Regular waitlist player - seat directly
        await seatPlayer(tableId, waitlist.player_id, clubDayId);
        showToast(`Seated ${waitlist.player?.nick || 'player'} at Table ${tables.find(t => t.id === tableId)?.table_number || '?'}`, 'success');
        onRefresh();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to seat player', 'error');
    }
  };

  const formatWaitTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  };

  if (allWaitlistEntries.length === 0) {
    return null;
  }

  return (
    <>
      <div className={`waitlist-panel ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="waitlist-panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
          <div className="waitlist-panel-title">
            <span className={`collapse-arrow ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
            <h3>All Waitlisted Players</h3>
            <span className="waitlist-count-badge">{allWaitlistEntries.length}</span>
          </div>
        </div>

        {!isCollapsed && (
          <div className="waitlist-panel-content">
            <div className="waitlist-panel-controls">
              <div className="waitlist-sort-controls">
                <span className="sort-label">Sort by:</span>
                <button
                  className={`sort-btn ${sortField === 'table' ? 'active' : ''}`}
                  onClick={() => handleSort('table')}
                >
                  Table {sortField === 'table' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  className={`sort-btn ${sortField === 'player' ? 'active' : ''}`}
                  onClick={() => handleSort('player')}
                >
                  Player {sortField === 'player' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  className={`sort-btn ${sortField === 'waitTime' ? 'active' : ''}`}
                  onClick={() => handleSort('waitTime')}
                >
                  Wait Time {sortField === 'waitTime' && (sortDirection === 'asc' ? '↑' : '↓')}
                </button>
              </div>
            </div>

            <div className="waitlist-panel-list">
              {sortedEntries.map(({ waitlist, table, waitTime }) => (
                <div key={`${waitlist.id}-${waitlist.player_id}`} className="waitlist-panel-item">
                  <div className="waitlist-item-info">
                    <div className="waitlist-item-main">
                      <span className="waitlist-player-name">
                        {waitlist.player?.nick || waitlist.player?.name || 'Unknown'}
                      </span>
                      {waitlist.called_in && (
                        <span className="waitlist-called-in-badge">Called In</span>
                      )}
                    </div>
                    <div className="waitlist-item-details">
                      <span className="waitlist-table-info">
                        Table {table?.table_number || '?'} • {table?.game_type || 'Unknown'} • {table?.stakes_text || ''}
                      </span>
                      <span className="waitlist-wait-time">
                        Waiting: {formatWaitTime(waitTime)}
                      </span>
                    </div>
                  </div>
                  <div className="waitlist-item-actions">
                    {waitlist.called_in ? (
                      <button
                        className="waitlist-seat-btn called-in"
                        onClick={() => handleSeatPlayer(waitlist, table?.id || '')}
                      >
                        Pay & Seat
                      </button>
                    ) : (
                      <button
                        className="waitlist-seat-btn"
                        onClick={() => handleSeatPlayer(waitlist, table?.id || '')}
                      >
                        Seat Now
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {calledInModal && (
        <DoorFeeModal
          playerName={calledInModal.playerName}
          defaultAmount={20}
          tables={tables.filter(table => table.status !== 'CLOSED')}
          showTableSelection={true}
          defaultTableId={calledInModal.tableId}
          onConfirm={async (amount, selectedTableId, isPreviousPlayer) => {
            try {
              if (isPreviousPlayer) {
                await seatPlayer(selectedTableId, calledInModal.entry.player_id, clubDayId);
                showToast(`Previous player ${calledInModal.playerName} seated (no door fee)`, 'success');
              } else {
                await seatCalledInPlayer(
                  selectedTableId,
                  calledInModal.entry.player_id,
                  clubDayId,
                  amount,
                  adminUser
                );
                showToast(`Seated ${calledInModal.playerName} and charged $${amount}`, 'success');
              }
              setCalledInModal(null);
              onRefresh();
            } catch (error: any) {
              showToast(error.message || 'Failed to seat player', 'error');
            }
          }}
          onClose={() => setCalledInModal(null)}
        />
      )}
    </>
  );
}
