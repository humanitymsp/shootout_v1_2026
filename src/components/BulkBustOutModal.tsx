import { useState } from 'react';
import { removePlayerFromSeat, removePlayerFromAllWaitlists } from '../lib/api';
import type { SelectedPlayerEntry } from '../pages/AdminPage';
import { showToast } from './Toast';
import './BulkBustOutModal.css';

interface BulkBustOutModalProps {
  selectedPlayers: Record<string, SelectedPlayerEntry>;
  tables: Array<{ id: string; table_number: number }>;
  clubDayId: string;
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
  onClearSelection: () => void;
}

interface BustOutResult {
  playerId: string;
  playerNick?: string;
  success: boolean;
  error?: string;
}

export default function BulkBustOutModal({
  selectedPlayers,
  tables,
  clubDayId,
  adminUser,
  onClose,
  onSuccess,
  onClearSelection,
}: BulkBustOutModalProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BustOutResult[]>([]);

  const selectedEntries = Object.values(selectedPlayers);
  const seatedPlayers = selectedEntries.filter(e => !e.fromWaitlist);

  const handleBustOut = async () => {
    if (seatedPlayers.length === 0) {
      showToast('No seated players selected', 'error');
      return;
    }

    setLoading(true);
    setResults([]);

    const bustOutResults: BustOutResult[] = [];
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

    try {
      // Process bust outs in parallel batches
      const batchSize = 5;
      for (let i = 0; i < seatedPlayers.length; i += batchSize) {
        const batch = seatedPlayers.slice(i, i + batchSize);
        const batchPromises = batch.map(async (entry) => {
          try {
            await removePlayerFromSeat(entry.entryId, entry.sourceTableId, adminUser);
            
            // Remove busted player from all waitlists
            try {
              await removePlayerFromAllWaitlists(entry.playerId, clubDayId);
            } catch { /* best effort */ }
            
            // Store bust out info for re-seating
            try {
              const table = tables.find(t => t.id === entry.sourceTableId);
              const bustOutData = {
                playerId: entry.playerId,
                playerNick: entry.playerNick || 'Unknown',
                tableId: entry.sourceTableId,
                tableNumber: table?.table_number || 0,
                bustedOutAt: Date.now(),
              };
              const recentBustOuts = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]');
              recentBustOuts.push(bustOutData);
              // Keep only last 30 minutes worth
              const filtered = recentBustOuts.filter((b: any) => b.bustedOutAt > thirtyMinutesAgo);
              localStorage.setItem('recent-bust-outs', JSON.stringify(filtered));
            } catch (error) {
              console.warn('Failed to store bust out info:', error);
            }

            return {
              playerId: entry.playerId,
              playerNick: entry.playerNick,
              success: true,
            };
          } catch (error: any) {
            return {
              playerId: entry.playerId,
              playerNick: entry.playerNick,
              success: false,
              error: error.message || 'Failed to bust out',
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        bustOutResults.push(...batchResults);
        setResults([...bustOutResults]);
      }

      const successCount = bustOutResults.filter(r => r.success).length;
      const failCount = bustOutResults.filter(r => !r.success).length;

      if (successCount > 0) {
        showToast(`Successfully busted out ${successCount} player${successCount !== 1 ? 's' : ''}`, 'success');
      }
      if (failCount > 0) {
        showToast(`${failCount} player${failCount !== 1 ? 's' : ''} failed to bust out`, 'error');
      }

      if (failCount === 0) {
        onClearSelection();
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1000);
      }
    } catch (error: any) {
      showToast(error.message || 'Bulk bust out failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (seatedPlayers.length === 0) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content bulk-bust-out-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Bulk Bust Out</h2>
            <button className="close-button" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <p>No seated players selected. Only seated players can be busted out.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content bulk-bust-out-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Bulk Bust Out</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p>Bust out {seatedPlayers.length} selected player{seatedPlayers.length !== 1 ? 's' : ''}?</p>
          <div className="selected-players-list">
            {seatedPlayers.map((entry) => {
              const table = tables.find(t => t.id === entry.sourceTableId);
              return (
                <div key={entry.playerId} className="selected-player-item">
                  <span className="player-name">{entry.playerNick || 'Unknown'}</span>
                  <span className="player-table">Table {table?.table_number || '?'}</span>
                </div>
              );
            })}
          </div>

          {results.length > 0 && (
            <div className="results-section">
              <h3>Results:</h3>
              <div className="results-list">
                {results.map((result) => (
                  <div key={result.playerId} className={`result-item ${result.success ? 'success' : 'error'}`}>
                    <span className="result-player">{result.playerNick || 'Unknown'}</span>
                    <span className="result-status">
                      {result.success ? '✓ Busted Out' : `✗ ${result.error}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              className="btn-primary btn-bust-out"
              onClick={handleBustOut}
              disabled={loading || results.length > 0 && results.every(r => r.success)}
            >
              {loading ? 'Busting Out...' : `Bust Out ${seatedPlayers.length} Player${seatedPlayers.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
