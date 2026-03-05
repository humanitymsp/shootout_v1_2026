import { useState, useEffect } from 'react';
import { getCheckInsForClubDay, createRefund, getTablesForClubDay, getSeatedPlayersForTable } from '../lib/api';
import { getAllPlayersLocal } from '../lib/localStoragePlayers';
import { generateClient } from '../lib/graphql-client';
import { log, logError } from '../lib/logger';
import { showToast } from './Toast';
import type { CheckIn, Player } from '../types';
import './RefundModal.css';

const client = generateClient();

interface RefundModalProps {
  clubDayId: string;
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RefundModal({ clubDayId, adminUser, onClose, onSuccess }: RefundModalProps) {
  const [nick, setNick] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [searchResults, setSearchResults] = useState<Player[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [allEligiblePlayers, setAllEligiblePlayers] = useState<Player[]>([]);
  const [loadingEligiblePlayers, setLoadingEligiblePlayers] = useState(true);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [selectedCheckIn, setSelectedCheckIn] = useState<CheckIn | null>(null);
  const [reason, setReason] = useState('');
  const [removeFromTable, setRemoveFromTable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const trimmedNick = nick.trim();
    if (trimmedNick.length >= 2 && !selectedPlayer) {
      const lowerQuery = trimmedNick.toLowerCase();
      const results = allEligiblePlayers.filter(player => {
        const name = (player.name || '').toLowerCase();
        const n = (player.nick || '').toLowerCase();
        return name.includes(lowerQuery) || n.includes(lowerQuery);
      });
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
    setIsSearching(false);
  }, [nick, allEligiblePlayers, selectedPlayer]);

  // Load all eligible players (those with check-ins or seated) when modal opens
  useEffect(() => {
    const loadEligiblePlayers = async () => {
      setLoadingEligiblePlayers(true);
      try {
        log('📋 Loading eligible players for clubDayId:', clubDayId);
        
        const [clubDayCheckIns, tables] = await Promise.all([
          getCheckInsForClubDay(clubDayId),
          getTablesForClubDay(clubDayId)
        ]);
        
        log('📋 Check-ins found:', clubDayCheckIns.length);
        log('📋 Tables found:', tables.length);
        log('📋 Check-in player IDs:', clubDayCheckIns.map(ci => ci.player_id).filter(Boolean));
        
        // Get all seated players from all tables
        const seatedPromises = tables.map(table => 
          getSeatedPlayersForTable(table.id, clubDayId).catch(error => {
            logError('Error getting seated players for table:', table.id, error);
            return [];
          })
        );
        const allSeatedResults = await Promise.all(seatedPromises);
        
        log('📋 Seated results from tables:', allSeatedResults.map((seated, idx) => 
          `Table ${tables[idx]?.table_number}: ${seated.length} players`
        ));
        
        // Collect all unique player IDs who are eligible
        const eligiblePlayerIds = new Set<string>();
        clubDayCheckIns.forEach(ci => {
          if (ci.player_id) {
            eligiblePlayerIds.add(ci.player_id);
          }
        });
        allSeatedResults.forEach(seated => {
          seated.forEach(seat => {
            if (seat.player_id) {
              eligiblePlayerIds.add(seat.player_id);
            }
          });
        });
        
        log('📋 Total unique eligible player IDs:', eligiblePlayerIds.size);
        log('📋 Eligible player IDs:', Array.from(eligiblePlayerIds));
        
        if (eligiblePlayerIds.size === 0) {
          log('⚠️ No eligible player IDs found! Check-ins:', clubDayCheckIns.length, 'Seated players:', allSeatedResults.flat().length);
          setAllEligiblePlayers([]);
          setLoadingEligiblePlayers(false);
          return;
        }
        
        const localPlayers = getAllPlayersLocal();
        log('📋 Total players from localStorage:', localPlayers.length);
        
        // Filter to only eligible players (those with check-ins or seated)
        const validPlayers = localPlayers.filter(player => {
          const isEligible = eligiblePlayerIds.has(player.id);
          if (isEligible) {
            log('✅ Found eligible player:', player.nick, player.id);
          }
          return isEligible;
        });
        
        log('📋 Eligible players found:', validPlayers.length);
        if (validPlayers.length === 0 && eligiblePlayerIds.size > 0) {
          logError('❌ No players matched eligible IDs!');
          logError('❌ Eligible IDs:', Array.from(eligiblePlayerIds));
          logError('❌ Local player IDs:', localPlayers.map(p => p.id).slice(0, 10));
          logError('❌ This suggests player IDs in check-ins/seats don\'t match localStorage player IDs');
        }
        
        log('📋 Valid players after filtering:', validPlayers.length);
        log('📋 Player nicks:', validPlayers.map(p => p.nick));
        
        // Sort by nick for easier browsing
        validPlayers.sort((a, b) => a.nick.localeCompare(b.nick));
        
        log('📋 Final loaded eligible players for refund:', validPlayers.length);
        setAllEligiblePlayers(validPlayers);
      } catch (error) {
        logError('❌ Error loading eligible players:', error);
        setAllEligiblePlayers([]);
      } finally {
        setLoadingEligiblePlayers(false);
      }
    };
    
    if (clubDayId) {
      loadEligiblePlayers();
    } else {
      log('⚠️ No clubDayId provided, cannot load eligible players');
      setAllEligiblePlayers([]);
      setLoadingEligiblePlayers(false);
    }
  }, [clubDayId]);

  useEffect(() => {
    if (selectedPlayer) {
      loadPlayerCheckIns();
    } else {
      setCheckIns([]);
      setSelectedCheckIn(null);
    }
  }, [selectedPlayer, clubDayId]);

  const loadPlayerCheckIns = async () => {
    if (!selectedPlayer) return;
    try {
      const allCheckIns = await getCheckInsForClubDay(clubDayId);
      log('🔍 All check-ins for day:', allCheckIns.length, 'player IDs:', allCheckIns.map(ci => ci.player_id).slice(0, 5));
      log('🔍 Looking for player ID:', selectedPlayer.id, 'nick:', selectedPlayer.nick);
      const playerCheckIns = allCheckIns.filter(ci => ci.player_id === selectedPlayer.id);
      log('🔍 Matched check-ins:', playerCheckIns.length);
      setCheckIns(playerCheckIns);
      // Auto-select if only one check-in
      if (playerCheckIns.length === 1 && !playerCheckIns[0].refunded_at) {
        setSelectedCheckIn(playerCheckIns[0]);
      }
    } catch (error) {
      logError('Error loading player check-ins:', error);
      setCheckIns([]);
    }
  };

  const handleSelectPlayer = (player: Player) => {
    setSelectedPlayer(player);
    setNick(player.nick);
    setSearchResults([]);
  };

  const handleRefund = async () => {
    if (!selectedCheckIn) {
      setError('Please select a check-in to refund');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }

    setLoading(true);

    try {
      log('💰 Processing refund for check-in:', selectedCheckIn.id, 'amount:', selectedCheckIn.door_fee_amount, 'player:', selectedPlayer?.nick);
      // Create the refund
      await createRefund(
        selectedCheckIn.id,
        selectedCheckIn.door_fee_amount,
        reason,
        adminUser
      );
      log('✅ Refund created successfully');

      // Remove player from table/waitlist if requested
      if (removeFromTable) {
        try {
          // Find and remove from table seat
          const seats = await client.models.TableSeat.list({
            filter: {
              and: [
                { playerId: { eq: selectedCheckIn.player_id } },
                { clubDayId: { eq: clubDayId } },
                { leftAt: { attributeExists: false } },
              ],
            },
          });

          if (seats.data && seats.data.length > 0) {
            for (const seat of seats.data) {
              await client.models.TableSeat.update({
                id: seat.id,
                leftAt: new Date().toISOString(),
              });
            }
          }

          // Find and remove from waitlist
          const waitlist = await client.models.TableWaitlist.list({
            filter: {
              and: [
                { playerId: { eq: selectedCheckIn.player_id } },
                { clubDayId: { eq: clubDayId } },
                { removedAt: { attributeExists: false } },
              ],
            },
          });

          if (waitlist.data && waitlist.data.length > 0) {
            for (const wl of waitlist.data) {
              await client.models.TableWaitlist.update({
                id: wl.id,
                removedAt: new Date().toISOString(),
              });
            }
          }
        } catch (removeError) {
          logError('Error removing player from table:', removeError);
          // Don't fail the refund if table removal fails
        }
      }

      showToast(`Refund processed for ${selectedPlayer?.nick || 'player'}`, 'success');
      onSuccess();
      // Reset form
      setSelectedPlayer(null);
      setNick('');
      setCheckIns([]);
      setSelectedCheckIn(null);
      setReason('');
      setRemoveFromTable(true);
      setError('');
      onClose();
    } catch (err: any) {
      logError('❌ Refund processing error:', err);
      const msg = err.message || 'Failed to process refund';
      setError(msg);
      showToast(msg, 'error');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content refund-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Refund Buy-in</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-group required">
            <label>Player nick</label>
            <input
              type="text"
              value={nick}
              onChange={(e) => {
                const value = e.target.value;
                setNick(value);
                if (value !== selectedPlayer?.nick) {
                  setSelectedPlayer(null);
                }
              }}
              placeholder="Required"
              required
              autoComplete="off"
            />
          </div>

          {nick.trim().length >= 2 && !selectedPlayer && (
            <>
              {isSearching ? (
                <div className="searching-message">Searching...</div>
              ) : searchResults.length > 0 ? (
                <div className="search-results">
                  {searchResults.map((player) => (
                    <div
                      key={player.id}
                      className="search-result-item"
                      onClick={() => handleSelectPlayer(player)}
                    >
                      <strong>{player.nick}</strong>
                      {player.name !== player.nick && (
                        <span className="search-result-fullname"> ({player.name})</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-results">
                  No players found with check-ins for today matching "{nick}".
                </div>
              )}
            </>
          )}
          {nick.trim().length > 0 && nick.trim().length < 2 && (
            <div className="search-hint">Type at least 2 characters to search</div>
          )}

          {/* List of all signed-in players for the day */}
          {!selectedPlayer && (
            <div className="eligible-players-section">
              <h4>All Signed-In Players Today ({allEligiblePlayers.length})</h4>
              {loadingEligiblePlayers ? (
                <div className="loading-players">Loading players...</div>
              ) : allEligiblePlayers.length > 0 ? (
                <div className="eligible-players-list">
                  {allEligiblePlayers.map((player) => (
                    <div
                      key={player.id}
                      className={`eligible-player-item ${nick.trim().length >= 2 && 
                        (player.nick.toLowerCase().includes(nick.toLowerCase()) || 
                         player.name.toLowerCase().includes(nick.toLowerCase())) ? 'highlighted' : ''}`}
                      onClick={() => handleSelectPlayer(player)}
                    >
                      <strong>{player.nick}</strong>
                      {player.name !== player.nick && (
                        <span className="player-fullname"> ({player.name})</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-eligible-players">No players signed in for today.</div>
              )}
            </div>
          )}

          {selectedPlayer && (
            <div className="selected-player">
              <strong>Selected Player: {selectedPlayer.nick}</strong>
              {selectedPlayer.name !== selectedPlayer.nick && (
                <span> ({selectedPlayer.name})</span>
              )}
            </div>
          )}

          {selectedPlayer && checkIns.length === 0 && (
            <div className="no-checkins">
              No active check-ins found for this player today.
            </div>
          )}

          {selectedPlayer && checkIns.length > 0 && (
            <div className="checkins-list">
              <h4>Check-ins for {selectedPlayer.nick}:</h4>
              {checkIns.map((ci) => (
              <div
                key={ci.id}
                className={`checkin-item ${selectedCheckIn?.id === ci.id ? 'selected' : ''}`}
                onClick={() => { setSelectedCheckIn(ci); if (error) setError(''); }}
              >
                <div className="checkin-header">
                  <strong>{selectedPlayer?.nick || ci.player?.nick || 'Unknown'}</strong>
                  <span className={`status ${ci.refunded_at ? 'refunded' : 'active'}`}>
                    {ci.refunded_at ? 'Refunded' : 'Active'}
                  </span>
                </div>
                <div className="checkin-details">
                  <span>Time: {new Date(ci.checkin_time).toLocaleString()}</span>
                  <span>Amount: ${ci.door_fee_amount}</span>
                  {ci.receipt && <span>Receipt #{ci.receipt.receipt_number}</span>}
                </div>
              </div>
              ))}
            </div>
          )}

          {selectedCheckIn && !selectedCheckIn.refunded_at && (
            <div className="refund-form">
              {error && <div className="error-message">{error}</div>}
              <div className="form-group">
                <label>Refund Method</label>
                <input type="text" value="Cash" disabled />
              </div>
              <div className="form-group">
                <label>Reason (required)</label>
                <textarea
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); if (error) setError(''); }}
                  placeholder="Enter reason for refund..."
                  required
                />
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={removeFromTable}
                    onChange={(e) => setRemoveFromTable(e.target.checked)}
                  />
                  Remove player from table/waitlist
                </label>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRefund}
              disabled={loading || !selectedCheckIn || !!selectedCheckIn.refunded_at}
            >
              {loading ? 'Processing...' : 'Confirm Refund'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
