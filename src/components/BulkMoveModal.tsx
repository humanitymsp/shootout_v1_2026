import { useMemo, useState } from 'react';
import type { PokerTable } from '../types';
import type { SelectedPlayerEntry } from '../pages/AdminPage';
import { movePlayerEntry, type MoveTargetType } from '../lib/api';
import './BulkMoveModal.css';

interface BulkMoveModalProps {
  selectedPlayers: Record<string, SelectedPlayerEntry>;
  tables: PokerTable[];
  clubDayId: string;
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
  onClearSelection: () => void;
}

interface MoveResult {
  playerId: string;
  playerNick?: string;
  status: 'success' | 'failed';
  message?: string;
}

export default function BulkMoveModal({
  selectedPlayers,
  tables,
  clubDayId,
  adminUser,
  onClose,
  onSuccess,
  onClearSelection,
}: BulkMoveModalProps) {
  const [targetTableId, setTargetTableId] = useState('');
  const [moveTarget, setMoveTarget] = useState<MoveTargetType>('auto');
  const [moving, setMoving] = useState(false);
  const [results, setResults] = useState<MoveResult[]>([]);
  const [error, setError] = useState('');

  const selectedList = useMemo(
    () => Object.values(selectedPlayers),
    [selectedPlayers]
  );

  const activeTables = useMemo(
    () => tables.filter((table) => table.status !== 'CLOSED'),
    [tables]
  );

  const tableNumberById = useMemo(() => {
    const map = new Map<string, number>();
    tables.forEach((table) => map.set(table.id, table.table_number));
    return map;
  }, [tables]);

  const handleMove = async () => {
    if (!targetTableId) {
      setError('Select a target table');
      return;
    }

    setMoving(true);
    setError('');
    setResults([]);

    const nextResults: MoveResult[] = [];
    for (const entry of selectedList) {
      try {
        await movePlayerEntry({
          playerId: entry.playerId,
          fromTableId: entry.sourceTableId,
          fromWaitlist: entry.fromWaitlist,
          entryId: entry.entryId,
          toTableId: targetTableId,
          clubDayId,
          adminUser,
          target: moveTarget,
        });
        nextResults.push({
          playerId: entry.playerId,
          playerNick: entry.playerNick,
          status: 'success',
        });
      } catch (err: any) {
        nextResults.push({
          playerId: entry.playerId,
          playerNick: entry.playerNick,
          status: 'failed',
          message: err?.message || 'Failed to move player',
        });
      }
      setResults([...nextResults]);
    }

    onSuccess();
    onClearSelection();
    setMoving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content bulk-move-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Bulk Move Players</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="bulk-move-summary">
            Selected: <strong>{selectedList.length}</strong> player{selectedList.length === 1 ? '' : 's'}
          </div>

          <div className="bulk-move-controls">
            <label>
              Target Table
              <select value={targetTableId} onChange={(e) => setTargetTableId(e.target.value)}>
                <option value="">Select table</option>
                {activeTables.map((table) => (
                  <option key={table.id} value={table.id}>
                    Table {table.table_number} ({table.status})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Move Behavior
              <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value as MoveTargetType)}>
                <option value="auto">Seat if available, otherwise waitlist</option>
                <option value="seat">Seat only (fail if full)</option>
                <option value="waitlist">Waitlist only</option>
              </select>
            </label>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="bulk-move-list">
            {selectedList.map((entry) => (
              <div key={entry.playerId} className="bulk-move-row">
                <div className="bulk-move-player">
                  <strong>{entry.playerNick || entry.playerId}</strong>
                  <span>
                    From Table {tableNumberById.get(entry.sourceTableId) ?? 'N/A'} • {entry.fromWaitlist ? 'Waitlist' : 'Seated'}
                  </span>
                </div>
                <div className="bulk-move-status">
                  {results.find((result) => result.playerId === entry.playerId)?.status === 'failed' && (
                    <span className="status-failed">Failed</span>
                  )}
                  {results.find((result) => result.playerId === entry.playerId)?.status === 'success' && (
                    <span className="status-success">Moved</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {results.some((result) => result.status === 'failed') && (
            <div className="bulk-move-errors">
              {results
                .filter((result) => result.status === 'failed')
                .map((result) => (
                  <div key={result.playerId} className="error-message">
                    {result.playerNick || result.playerId}: {result.message}
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={moving}>
            Close
          </button>
          <button className="btn-primary" onClick={handleMove} disabled={moving || selectedList.length === 0}>
            {moving ? 'Moving...' : 'Move Players'}
          </button>
        </div>
      </div>
    </div>
  );
}
