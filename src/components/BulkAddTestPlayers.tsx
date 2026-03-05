import { useState } from 'react';
import { createPlayer, seatPlayer, addPlayerToWaitlist, getSeatedPlayersForTable, createTable, getTablesForClubDay } from '../lib/api';
import { createPlayerLocal } from '../lib/localStoragePlayers';
import { log, logError } from '../lib/logger';
import { showToast } from './Toast';
import type { PokerTable } from '../types';
import './BulkAddTestPlayers.css';

interface BulkAddTestPlayersProps {
  tables: PokerTable[];
  clubDayId: string;
  adminUser: string;
  onComplete: () => void;
}

const TEST_PLAYER_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry',
  'Ivy', 'Jack', 'Kate', 'Liam', 'Mia', 'Noah', 'Olivia', 'Paul',
  'Quinn', 'Rachel', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier',
  'Yara', 'Zoe', 'Alex', 'Blake', 'Casey', 'Drew', 'Emma', 'Finn',
  'Gina', 'Hugo', 'Isla', 'Jake', 'Kara', 'Leo', 'Maya', 'Nate',
  'Owen', 'Paige', 'Quinn', 'Rosa', 'Sean', 'Tara', 'Ursa', 'Vince',
  'Will', 'Xara', 'Yuki', 'Zane', 'Aria', 'Ben', 'Cora', 'Dean',
  'Ella', 'Felix', 'Gwen', 'Hank', 'Iris', 'Jade', 'Kyle', 'Luna',
  'Miles', 'Nora', 'Omar', 'Piper', 'Quincy', 'Ruby', 'Sage', 'Troy',
  'Uma', 'Vera', 'Wade', 'Xena', 'Yves', 'Zara'
];

type AddMode = 'mixed' | 'waitlist-only' | 'seat-only';

export default function BulkAddTestPlayers({
  tables: _tables,
  clubDayId,
  adminUser,
  onComplete,
}: BulkAddTestPlayersProps) {
  const [showModal, setShowModal] = useState(true); // Start with modal open
  const [playerCount, setPlayerCount] = useState<number>(30);
  const [addMode, setAddMode] = useState<AddMode>('mixed');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 30 });
  const [status, setStatus] = useState<string>('');

  const generateUniqueName = (index: number): { name: string; nick: string } => {
    // Use base names from TEST_PLAYER_NAMES, cycling through them
    const baseName = TEST_PLAYER_NAMES[index % TEST_PLAYER_NAMES.length];
    const cycle = Math.floor(index / TEST_PLAYER_NAMES.length);
    
    // Generate unique name and nick
    let name: string;
    let nick: string;
    
    if (cycle === 0) {
      // First cycle: use base names with variations
      name = baseName;
      nick = `${baseName}${index + 1}`;
    } else {
      // Subsequent cycles: add cycle number to ensure uniqueness
      name = `${baseName} ${cycle + 1}`;
      nick = `${baseName}${cycle + 1}-${index + 1}`;
    }
    
    return { name, nick };
  };

  const handleBulkAdd = async () => {
    if (playerCount < 1 || playerCount > 200) {
      showToast('Please enter a number between 1 and 200', 'error');
      return;
    }

    setLoading(true);
    setProgress({ current: 0, total: playerCount });
    setStatus('Calculating tables needed...');

    // Set flag to pause auto-fix during bulk operation
    localStorage.setItem('bulk-operation-in-progress', 'true');

    try {
      // Calculate how many tables we need
      // Each table can seat 9 players + waitlist capacity
      const seatsPerTable = 9;
      const waitlistCapacityPerTable = 9; // Assume waitlist can hold 9
      const totalCapacityPerTable = seatsPerTable + waitlistCapacityPerTable;
      const tablesNeeded = Math.ceil(playerCount / totalCapacityPerTable);

      setStatus(`Creating ${tablesNeeded} table(s) if needed...`);

      // Get current tables and find available table numbers
      const currentTables = await getTablesForClubDay(clubDayId);
      const existingTableNumbers = new Set(currentTables.map(t => t.table_number));
      
      // Find table numbers we need to create
      const tablesToCreate: number[] = [];
      let nextTableNumber = 1;
      while (tablesToCreate.length < tablesNeeded) {
        if (!existingTableNumbers.has(nextTableNumber)) {
          tablesToCreate.push(nextTableNumber);
        }
        nextTableNumber++;
        // Safety limit
        if (nextTableNumber > 50) break;
      }

      // Create tables if needed
      if (tablesToCreate.length > 0) {
        setStatus(`Creating ${tablesToCreate.length} new table(s)...`);
        for (const tableNumber of tablesToCreate) {
          await createTable({
            clubDayId,
            tableNumber,
            gameType: 'NLH',
            stakesText: '$1/$2 No Limit',
            seatsTotal: 9,
            bombPotCount: 1,
            buyInLimits: '$40-$400',
          });
        }
        showToast(`Created ${tablesToCreate.length} new table(s)`, 'success');
      }

      // Refresh tables list
      const updatedTables = await getTablesForClubDay(clubDayId);
      const activeTables = updatedTables.filter(t => t.status !== 'CLOSED');
      
      if (activeTables.length === 0) {
        showToast('No active tables available after creation', 'error');
        setLoading(false);
        return;
      }

      setStatus(`Creating ${playerCount} test players...`);

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // Create players and randomly assign them
      for (let i = 0; i < playerCount; i++) {
        try {
          const { name, nick } = generateUniqueName(i);
          
          // Create player with unique phone number
          const phoneSuffix = String(i + 1000).padStart(4, '0');
          const player = await createPlayer({
            name,
            nick,
            phone: `555-${phoneSuffix}`,
          });

          // Sync to localStorage using the correct key prefix so TV/tablet views can resolve player names
          createPlayerLocal({ name, nick, phone: `555-${phoneSuffix}` });

          // Randomly select a table
          const randomTable = activeTables[Math.floor(Math.random() * activeTables.length)];
          
          // Determine if we should seat based on addMode
          let shouldSeat = false;
          if (addMode === 'seat-only') {
            shouldSeat = true;
          } else if (addMode === 'waitlist-only') {
            shouldSeat = false;
          } else {
            // Mixed mode: 70% chance to seat, 30% chance to waitlist
            shouldSeat = Math.random() < 0.7;
          }
          
          if (shouldSeat) {
            try {
              // Check current seats to see if table has room
              const currentSeats = await getSeatedPlayersForTable(randomTable.id, clubDayId);
              const maxSeats = randomTable.seats_total || 9;
              if (currentSeats.length < maxSeats) {
                await seatPlayer(randomTable.id, player.id, clubDayId);
                successCount++;
              } else {
                // Table is full, add to waitlist instead (unless seat-only mode)
                if (addMode === 'seat-only') {
                  // Try another table
                  let seated = false;
                  for (const table of activeTables) {
                    const seats = await getSeatedPlayersForTable(table.id, clubDayId);
                    if (seats.length < (table.seats_total || 9)) {
                      await seatPlayer(table.id, player.id, clubDayId);
                      seated = true;
                      successCount++;
                      break;
                    }
                  }
                  if (!seated) {
                    errorCount++;
                    errors.push(`${nick}: All tables full`);
                  }
                } else {
                  await addPlayerToWaitlist(randomTable.id, player.id, clubDayId, adminUser);
                  successCount++;
                }
              }
            } catch (seatError: any) {
              // If seating fails (table full), try waitlist (unless seat-only mode)
              if (addMode !== 'seat-only') {
                try {
                  await addPlayerToWaitlist(randomTable.id, player.id, clubDayId, adminUser);
                  successCount++;
                } catch (waitlistError: any) {
                  errorCount++;
                  errors.push(`${nick}: ${waitlistError.message || 'Failed to add'}`);
                }
              } else {
                errorCount++;
                errors.push(`${nick}: ${seatError.message || 'Failed to seat'}`);
              }
            }
          } else {
            // Add to waitlist
            try {
              await addPlayerToWaitlist(randomTable.id, player.id, clubDayId, adminUser);
              successCount++;
            } catch (waitlistError: any) {
              logError(`Failed to add ${nick} to waitlist:`, waitlistError);
              errorCount++;
              errors.push(`${nick}: ${waitlistError.message || 'Failed to add to waitlist'}`);
            }
          }

          setProgress({ current: i + 1, total: playerCount });
          setStatus(`Created ${i + 1}/${playerCount} players...`);
          
          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error: any) {
          errorCount++;
          errors.push(`Player ${i + 1}: ${error.message || 'Failed to create'}`);
        }
      }

      log(`Bulk add complete: ${successCount} success, ${errorCount} errors`);

      if (successCount > 0) {
        showToast(`Successfully added ${successCount} test players`, 'success');
      }
      if (errorCount > 0) {
        showToast(`${errorCount} players failed to add.`, 'error');
      }

      // Broadcast update to trigger refresh in all components
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({ type: 'player-update', action: 'bulk-add' });
        channel.close();
      } catch {
        // BroadcastChannel not supported
      }
      localStorage.setItem('player-updated', new Date().toISOString());
      localStorage.setItem('table-updated', new Date().toISOString());

      setShowModal(false);
      await new Promise(resolve => setTimeout(resolve, 500));
      onComplete();
    } catch (error: any) {
      showToast(error.message || 'Bulk add failed', 'error');
    } finally {
      // Clear the bulk operation flag to re-enable auto-fix
      localStorage.removeItem('bulk-operation-in-progress');
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <>
      {showModal && (
        <div className="modal-overlay" onClick={() => { if (!loading) { setShowModal(false); onComplete(); } }}>
          <div className="modal-content bulk-add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Test Players</h2>
              <button className="close-button" onClick={() => !loading && setShowModal(false)} disabled={loading}>×</button>
            </div>

            <div className="modal-body">
              <div className="bulk-add-info">
                <p>This will create test players and automatically create tables as needed.</p>
                <p>Players will be distributed across different tables.</p>
              </div>

              <div className="form-group">
                <label>Add Mode</label>
                <div className="add-mode-options">
                  <label className={`add-mode-option ${addMode === 'mixed' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="addMode"
                      value="mixed"
                      checked={addMode === 'mixed'}
                      onChange={() => setAddMode('mixed')}
                      disabled={loading}
                    />
                    <span className="add-mode-label">Mixed</span>
                    <span className="add-mode-desc">~70% seated, ~30% waitlist</span>
                  </label>
                  <label className={`add-mode-option ${addMode === 'waitlist-only' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="addMode"
                      value="waitlist-only"
                      checked={addMode === 'waitlist-only'}
                      onChange={() => setAddMode('waitlist-only')}
                      disabled={loading}
                    />
                    <span className="add-mode-label">Waitlist Only</span>
                    <span className="add-mode-desc">All players added to waitlist</span>
                  </label>
                  <label className={`add-mode-option ${addMode === 'seat-only' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="addMode"
                      value="seat-only"
                      checked={addMode === 'seat-only'}
                      onChange={() => setAddMode('seat-only')}
                      disabled={loading}
                    />
                    <span className="add-mode-label">Seat Only</span>
                    <span className="add-mode-desc">All players seated (up to capacity)</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label>Number of Test Players</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={playerCount}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setPlayerCount(isNaN(value) ? 30 : value);
                  }}
                  disabled={loading}
                  style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
                />
                <small>Enter how many test players to create (1-200)</small>
              </div>

              {status && (
                <div className="bulk-add-status" style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--admin-surface-alt)', borderRadius: '8px', fontSize: '0.9rem' }}>
                  {status}
                </div>
              )}

              {loading && (
                <div className="bulk-add-progress" style={{ marginTop: '1rem' }}>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                  <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--admin-muted)' }}>
                    {progress.current} / {progress.total}
                  </div>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button type="button" onClick={() => setShowModal(false)} disabled={loading}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkAdd}
                  disabled={loading || playerCount < 1 || playerCount > 200}
                  className="primary-button"
                >
                  {loading ? 'Creating...' : `Create ${playerCount} Test Players`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
