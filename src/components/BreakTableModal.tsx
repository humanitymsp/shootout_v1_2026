import { useEffect, useMemo, useState } from 'react';
import type { PokerTable, TableSeat, TableWaitlist } from '../types';
import { getSeatedPlayersForTable, getWaitlistForTable, bulkMovePlayers, updateTable, createTable, deleteTable, removePlayerFromSeat, removePlayerFromWaitlist } from '../lib/api';
import { logWarn } from '../lib/logger';
import './BreakTableModal.css';

const STAKES_OPTIONS = [
  '$1/$2 No Limit',
  '$1/$3 No Limit',
  '$2/$5 No Limit',
  '$1/$2/$5 No Limit',
  '$5/$10 No Limit',
  '$10/$20 No Limit',
  '$25/$50 No Limit',
  'PLO',
  'Big-O',
  'Limit',
  'Mixed',
  'Custom',
];

const BUY_IN_LIMITS_OPTIONS = [
  '$40-$400',
  '$100-$500',
  '$200-$1000',
  '$300-$1000',
  '$500-$2000',
  '$1000-$5000',
  'See Floor',
  'Custom',
];

interface BreakTableModalProps {
  clubDayId: string;
  tables: PokerTable[];
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
  initialSourceTableId?: string | null;
}

interface BreakTableEntry {
  playerId: string;
  playerNick?: string;
  fromWaitlist: boolean;
  entryId: string;
  sourceTableId: string;
}

export default function BreakTableModal({
  clubDayId,
  tables,
  adminUser,
  onClose,
  onSuccess,
  initialSourceTableId,
}: BreakTableModalProps) {
  const [sourceTableId, setSourceTableId] = useState(initialSourceTableId || '');
  const [targetTableId, setTargetTableId] = useState('');
  const [removeAll, setRemoveAll] = useState(false);
  const [createNewTable, setCreateNewTable] = useState(false);
  const [entries, setEntries] = useState<BreakTableEntry[]>([]);
  const [choices, setChoices] = useState<Record<string, 'seat' | 'waitlist'>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [closeSource, setCloseSource] = useState(true);
  const [targetSeatedCount, setTargetSeatedCount] = useState(0);
  const [results, setResults] = useState<Record<string, string>>({});
  
  // New table configuration
  const [newTableNumber, setNewTableNumber] = useState<number>(1);
  const [newGameType, setNewGameType] = useState<PokerTable['game_type']>('NLH');
  const [newStakesText, setNewStakesText] = useState('');
  const [newSelectedStakes, setNewSelectedStakes] = useState<string>('');
  const [showCustomStakes, setShowCustomStakes] = useState(false);
  const [newSeatsTotal, setNewSeatsTotal] = useState(9);
  const [newBombPotCount, setNewBombPotCount] = useState(1);
  const [newLockoutCount, setNewLockoutCount] = useState(0);
  const [newBuyInLimits, setNewBuyInLimits] = useState('See Floor');
  const [newSelectedBuyInLimits, setNewSelectedBuyInLimits] = useState<string>('See Floor');
  const [showCustomBuyInLimits, setShowCustomBuyInLimits] = useState(false);

  const activeTables = useMemo(
    () => tables.filter((table) => table.status !== 'CLOSED'),
    [tables]
  );

  const existingTableNumbers = useMemo(
    () => tables.map((table) => table.table_number),
    [tables]
  );

  const availableTableNumbers = useMemo(
    () => Array.from({ length: 20 }, (_, i) => i + 1).filter(
      (n) => !existingTableNumbers.includes(n)
    ),
    [existingTableNumbers]
  );

  const tableNumberById = useMemo(() => {
    const map = new Map<string, number>();
    tables.forEach((table) => map.set(table.id, table.table_number));
    return map;
  }, [tables]);

  const targetTable = useMemo(
    () => tables.find((table) => table.id === targetTableId),
    [tables, targetTableId]
  );

  const seatsAvailable = useMemo(() => {
    if (createNewTable) return newSeatsTotal; // New table starts empty
    if (!targetTable) return 0;
    return Math.max(targetTable.seats_total - targetSeatedCount, 0);
  }, [targetTable, targetSeatedCount, createNewTable, newSeatsTotal]);

  useEffect(() => {
    if (!sourceTableId) {
      setEntries([]);
      setChoices({});
      return;
    }

    const loadSource = async () => {
      setLoading(true);
      setError('');
      try {
        const [seated, waitlist] = await Promise.all([
          getSeatedPlayersForTable(sourceTableId),
          getWaitlistForTable(sourceTableId),
        ]);

        const seatedEntries = seated.map((seat: TableSeat) => ({
          playerId: seat.player_id,
          playerNick: seat.player?.nick,
          fromWaitlist: false,
          entryId: seat.id,
          sourceTableId,
        }));
        const waitlistEntries = waitlist.map((wl: TableWaitlist) => ({
          playerId: wl.player_id,
          playerNick: wl.player?.nick,
          fromWaitlist: true,
          entryId: wl.id,
          sourceTableId,
        }));

        const combined = [...seatedEntries, ...waitlistEntries];
        setEntries(combined);
        setResults({});

        if (targetTableId || createNewTable) {
          const defaultChoices: Record<string, 'seat' | 'waitlist'> = {};
          let seatsRemaining = seatsAvailable;
          combined.forEach((entry) => {
            if (seatsRemaining > 0) {
              defaultChoices[entry.playerId] = 'seat';
              seatsRemaining -= 1;
            } else {
              defaultChoices[entry.playerId] = 'waitlist';
            }
          });
          setChoices(defaultChoices);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load table players');
      } finally {
        setLoading(false);
      }
    };

    loadSource();
  }, [sourceTableId, targetTableId, seatsAvailable, createNewTable]);

  useEffect(() => {
    if (!targetTableId || createNewTable) {
      setTargetSeatedCount(0);
      return;
    }

    const loadTargetSeats = async () => {
      try {
        const seated = await getSeatedPlayersForTable(targetTableId);
        setTargetSeatedCount(seated.length);
      } catch {
        setTargetSeatedCount(0);
      }
    };

    loadTargetSeats();
  }, [targetTableId, createNewTable]);

  // Reset target table when toggling create new table option
  useEffect(() => {
    if (createNewTable) {
      setTargetTableId('');
      setTargetSeatedCount(0);
      setRemoveAll(false);
    }
  }, [createNewTable]);

  // Reset removeAll when selecting a target table
  useEffect(() => {
    if (targetTableId) {
      setRemoveAll(false);
    }
  }, [targetTableId]);

  // Reset createNewTable when selecting removeAll
  useEffect(() => {
    if (removeAll) {
      setCreateNewTable(false);
      setTargetTableId('');
    }
  }, [removeAll]);

  // Update source table when initialSourceTableId changes
  useEffect(() => {
    if (initialSourceTableId && initialSourceTableId !== sourceTableId) {
      setSourceTableId(initialSourceTableId);
    }
  }, [initialSourceTableId]);

  const handleStakesChange = (value: string) => {
    setNewSelectedStakes(value);
    if (value === 'Custom') {
      setShowCustomStakes(true);
      setNewStakesText('');
    } else {
      setShowCustomStakes(false);
      setNewStakesText(value);
    }
  };

  const handleBuyInLimitsChange = (value: string) => {
    setNewSelectedBuyInLimits(value);
    if (value === 'Custom') {
      setShowCustomBuyInLimits(true);
      setNewBuyInLimits('');
    } else {
      setShowCustomBuyInLimits(false);
      setNewBuyInLimits(value);
    }
  };

  const selectedSeatsCount = Object.values(choices).filter((choice) => choice === 'seat').length;
  const overCapacity = (targetTable || createNewTable) ? selectedSeatsCount > seatsAvailable : false;

  const handleMove = async () => {
    if (!sourceTableId) {
      setError('Select source table');
      return;
    }

    if (!createNewTable && !targetTableId && !removeAll) {
      setError('Select target table, choose to create a new table, or select Remove All');
      return;
    }

    // Handle Remove All case
    if (removeAll) {
      const playerCount = entries.length;
      const confirmMessage = playerCount > 0
        ? `WARNING: Remove All Players and Delete Table\n\n` +
          `This will permanently remove all ${playerCount} player(s) from Table ${tableNumberById.get(sourceTableId) ?? 'N/A'} and delete the table.\n\n` +
          `This action cannot be undone. Continue?`
        : `Delete Table ${tableNumberById.get(sourceTableId) ?? 'N/A'}?`;
      
      if (!confirm(confirmMessage)) return;

      setLoading(true);
      setError('');
      setResults({});

      try {
        // Remove all players from seats and waitlist
        const removalResults: Record<string, string> = {};
        
        for (const entry of entries) {
          try {
            if (entry.fromWaitlist) {
              await removePlayerFromWaitlist(entry.entryId, adminUser);
            } else {
              await removePlayerFromSeat(entry.entryId, sourceTableId, adminUser);
            }
            removalResults[entry.playerId] = 'success';
          } catch (err: any) {
            removalResults[entry.playerId] = err?.message || 'Failed';
          }
        }

        setResults(removalResults);

        // Delete the table
        await deleteTable(sourceTableId);

        // Broadcast updates
        try {
          const adminChannel = new BroadcastChannel('admin-updates');
          adminChannel.postMessage({
            type: 'table-update',
            action: 'table-deleted',
            tableId: sourceTableId,
          });
          adminChannel.close();

          const tvChannel = new BroadcastChannel('tv-updates');
          tvChannel.postMessage({ type: 'table-updated', tableId: sourceTableId });
          tvChannel.close();
        } catch (error) {
          logWarn('📡 BroadcastChannel not available:', error);
        }

        localStorage.setItem('table-updated', new Date().toISOString());
        localStorage.setItem('player-updated', new Date().toISOString());
        localStorage.setItem('tv-updated', new Date().toISOString());

        onSuccess();
      } catch (err: any) {
        setError(err?.message || 'Failed to remove all players and delete table');
        console.error('Remove all error:', err);
        setLoading(false);
      }
      return;
    }

    if (createNewTable) {
      if (!newSelectedStakes || (newSelectedStakes === 'Custom' && !newStakesText.trim())) {
        setError('Stakes text is required for new table');
        return;
      }
      if (!newSelectedBuyInLimits || (newSelectedBuyInLimits === 'Custom' && !newBuyInLimits.trim())) {
        setError('Buy-in limits are required for new table');
        return;
      }
      if (newSeatsTotal < 1 || newSeatsTotal > 9) {
        setError('Tables must have between 1 and 9 seats');
        return;
      }
      if (availableTableNumbers.length === 0 || !availableTableNumbers.includes(newTableNumber)) {
        setError('Selected table number is not available');
        return;
      }
    }

    if (!createNewTable && overCapacity) {
      setError('Seat selections exceed available seats');
      return;
    }

    setLoading(true);
    setError('');
    setResults({});

    try {
      let finalTargetTableId = targetTableId;

      // Create new table if requested
      if (createNewTable) {
        const finalStakesText = newSelectedStakes === 'Custom' ? newStakesText.trim() : newSelectedStakes;
        const finalBuyInLimits = newSelectedBuyInLimits === 'Custom' ? newBuyInLimits.trim() : newSelectedBuyInLimits;
        
        const newTable = await createTable({
          clubDayId,
          tableNumber: newTableNumber,
          gameType: newGameType,
          stakesText: finalStakesText,
          seatsTotal: newSeatsTotal,
          bombPotCount: newBombPotCount,
          lockoutCount: newLockoutCount,
          buyInLimits: finalBuyInLimits,
        });
        finalTargetTableId = newTable.id;
        // Update target seated count for capacity check
        setTargetSeatedCount(0);
      }

      // Prepare bulk move entries
      const bulkEntries = entries.map(entry => ({
        playerId: entry.playerId,
        fromWaitlist: entry.fromWaitlist,
        entryId: entry.entryId,
        target: (choices[entry.playerId] || 'waitlist') as 'seat' | 'waitlist',
      }));

      // Execute bulk move (all operations in parallel batches)
      const moveResults = await bulkMovePlayers({
        entries: bulkEntries,
        fromTableId: sourceTableId,
        toTableId: finalTargetTableId,
        clubDayId,
        adminUser,
      });

      // Update results state once
      const nextResults: Record<string, string> = {};
      moveResults.forEach(result => {
        if (result.success) {
          nextResults[result.playerId] = 'success';
        } else {
          nextResults[result.playerId] = result.error || 'Failed';
        }
      });
      setResults(nextResults);

      // Check if any moves failed
      const failures = moveResults.filter(r => !r.success);
      const successCount = moveResults.filter(r => r.success).length;
      
      if (failures.length > 0) {
        const failureCount = failures.length;
        const totalCount = moveResults.length;
        setError(`${failureCount} of ${totalCount} moves failed. Check individual statuses.`);
      }

      // Close source table if requested
      if (closeSource) {
        try {
          await updateTable(sourceTableId, { status: 'CLOSED' });
        } catch (err: any) {
          console.error('Failed to close source table:', err);
          // Don't fail the whole operation if closing fails
        }
      }

      // Broadcast updates to trigger real-time refresh in TableCard components
      // Do this even if some moves failed, so partial results are visible
      if (successCount > 0) {
        try {
          const adminChannel = new BroadcastChannel('admin-updates');
          // Broadcast player update
          adminChannel.postMessage({
            type: 'player-update',
            action: 'bulk-move',
            fromTableId: sourceTableId,
            toTableId: finalTargetTableId,
            playerIds: moveResults.filter(r => r.success).map(r => r.playerId),
          });
          
          // If a new table was created, also broadcast table update
          if (createNewTable) {
            adminChannel.postMessage({
              type: 'table-update',
              action: 'table-created',
              tableId: finalTargetTableId,
            });
            adminChannel.close();
            
            // Also broadcast to TV channel for TV view refresh
            try {
              const tvChannel = new BroadcastChannel('tv-updates');
              tvChannel.postMessage({ type: 'table-updated', tableId: finalTargetTableId });
              tvChannel.close();
            } catch (tvError) {
              logWarn('📡 TV BroadcastChannel not available:', tvError);
            }
          } else {
            adminChannel.close();
          }
        } catch (error) {
          logWarn('📡 BroadcastChannel not available, using localStorage:', error);
        }
        
        // Set localStorage timestamp to trigger refresh in other components
        localStorage.setItem('player-updated', new Date().toISOString());
        if (createNewTable) {
          localStorage.setItem('table-updated', new Date().toISOString());
          localStorage.setItem('tv-updated', new Date().toISOString());
        }
      }

      // Call onSuccess to refresh admin page (even if some moves failed, we want to show updates)
      // The user can see which moves failed from the error message and individual statuses
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to move players');
      console.error('Bulk move error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content break-table-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Break Table</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="break-table-controls">
            <label>
              Source Table
              <select value={sourceTableId} onChange={(e) => setSourceTableId(e.target.value)}>
                <option value="">Select source</option>
                {activeTables.map((table) => (
                  <option key={table.id} value={table.id}>
                    Table {table.table_number}
                  </option>
                ))}
              </select>
            </label>
            
            <label className="break-table-target-option">
              <input
                type="checkbox"
                checked={createNewTable}
                onChange={(e) => {
                  setCreateNewTable(e.target.checked);
                  if (e.target.checked) {
                    setRemoveAll(false);
                  }
                }}
              />
              Create new table
            </label>

            {!createNewTable ? (
              <label>
                Target Table
                <select 
                  value={removeAll ? 'REMOVE_ALL' : targetTableId} 
                  onChange={(e) => {
                    if (e.target.value === 'REMOVE_ALL') {
                      setRemoveAll(true);
                      setTargetTableId('');
                    } else {
                      setRemoveAll(false);
                      setTargetTableId(e.target.value);
                    }
                  }}
                >
                  <option value="">Select target</option>
                  <option value="REMOVE_ALL" style={{ color: '#ef4444', fontWeight: 'bold' }}>
                    Remove All (Delete Table & All Players)
                  </option>
                  {activeTables
                    .filter((table) => table.id !== sourceTableId)
                    .map((table) => (
                      <option key={table.id} value={table.id}>
                        Table {table.table_number} ({table.status})
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <div className="break-table-new-table-config">
                <label>
                  Table Number
                  <select 
                    value={newTableNumber} 
                    onChange={(e) => setNewTableNumber(Number(e.target.value))}
                  >
                    {availableTableNumbers.map((num) => (
                      <option key={num} value={num}>
                        Table {num}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Game Type
                  <select 
                    value={newGameType} 
                    onChange={(e) => setNewGameType(e.target.value as PokerTable['game_type'])}
                  >
                    <option value="NLH">NLH</option>
                    <option value="PLO">PLO</option>
                    <option value="BigO">Big-O</option>
                    <option value="Limit">Limit</option>
                    <option value="Mixed">Mixed</option>
                    <option value="Custom">Custom</option>
                  </select>
                </label>
                <label>
                  Stakes Text *
                  <select
                    value={newSelectedStakes}
                    onChange={(e) => handleStakesChange(e.target.value)}
                  >
                    <option value="">Select stakes</option>
                    {STAKES_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {showCustomStakes && (
                    <input
                      type="text"
                      value={newStakesText}
                      onChange={(e) => setNewStakesText(e.target.value)}
                      placeholder="Enter custom stakes"
                      required={showCustomStakes}
                      style={{ marginTop: '0.5rem' }}
                    />
                  )}
                </label>
                <div className="break-table-new-table-row">
                  <label>
                    Seats Total
                    <input
                      type="number"
                      min="1"
                      max="9"
                      value={newSeatsTotal}
                      onChange={(e) => setNewSeatsTotal(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Bomb Pot Count
                    <input
                      type="number"
                      min="0"
                      max="3"
                      value={newBombPotCount}
                      onChange={(e) => setNewBombPotCount(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Lockout Count
                    <input
                      type="number"
                      min="0"
                      max="3"
                      value={newLockoutCount}
                      onChange={(e) => setNewLockoutCount(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label>
                  Buy-in Limits *
                  <select
                    value={newSelectedBuyInLimits}
                    onChange={(e) => handleBuyInLimitsChange(e.target.value)}
                  >
                    <option value="">Select buy-in limits</option>
                    {BUY_IN_LIMITS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {showCustomBuyInLimits && (
                    <input
                      type="text"
                      value={newBuyInLimits}
                      onChange={(e) => setNewBuyInLimits(e.target.value)}
                      placeholder="Enter custom buy-in limits"
                      required={showCustomBuyInLimits}
                      style={{ marginTop: '0.5rem' }}
                    />
                  )}
                </label>
              </div>
            )}
          </div>

          {targetTable && !createNewTable && !removeAll && (
            <div className="break-table-capacity">
              Seats available: <strong>{seatsAvailable}</strong> (currently seated {targetSeatedCount})
            </div>
          )}
          {createNewTable && (
            <div className="break-table-capacity">
              New table will have <strong>{newSeatsTotal}</strong> seats
            </div>
          )}
          {removeAll && (
            <div className="break-table-capacity break-table-warning">
              Warning: This will delete the table and remove all {entries.length} player(s)
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
          {overCapacity && (
            <div className="error-message">
              Seat selections exceed available seats. Choose waitlist for some players.
            </div>
          )}

          <div className="break-table-list">
            {entries.length === 0 && !loading && <div className="empty-state">No players found.</div>}
            {entries.map((entry) => (
              <div key={entry.entryId} className="break-table-row">
                <div className="break-table-player">
                  <strong>{entry.playerNick || entry.playerId}</strong>
                  <span>
                    From Table {tableNumberById.get(entry.sourceTableId) ?? 'N/A'} • {entry.fromWaitlist ? 'Waitlist' : 'Seated'}
                  </span>
                </div>
                {!removeAll && (
                  <div className="break-table-choice">
                    <select
                      value={choices[entry.playerId] || 'waitlist'}
                      onChange={(e) =>
                        setChoices((prev) => ({
                          ...prev,
                          [entry.playerId]: e.target.value as 'seat' | 'waitlist',
                        }))
                      }
                    >
                      <option value="seat">Seat</option>
                      <option value="waitlist">Waitlist</option>
                    </select>
                  </div>
                )}
                {removeAll && (
                  <div className="break-table-choice">
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Will be removed</span>
                  </div>
                )}
                <div className="break-table-status">
                  {results[entry.playerId] === 'success' && <span className="status-success">{removeAll ? 'Removed' : 'Moved'}</span>}
                  {results[entry.playerId] && results[entry.playerId] !== 'success' && (
                    <span className="status-failed">{results[entry.playerId]}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!removeAll && (
            <label className="break-table-close">
              <input
                type="checkbox"
                checked={closeSource}
                onChange={(e) => setCloseSource(e.target.checked)}
              />
              Close source table after moving players
            </label>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Close
          </button>
          <button className="btn-primary" onClick={handleMove} disabled={loading || entries.length === 0}>
            {loading 
              ? (removeAll ? 'Removing...' : 'Moving...') 
              : (removeAll ? 'Remove All & Delete Table' : 'Move Players')}
          </button>
        </div>
      </div>
    </div>
  );
}
