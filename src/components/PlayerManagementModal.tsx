import { useState, useEffect } from 'react';
import { searchPlayers, getAllPlayers, getSeatedPlayersForPlayer, removePlayerFromSeat, getClient, findInactivePlayers, pruneInactivePlayers } from '../lib/api';
import type { Player } from '../types';
import './PlayerManagementModal.css';

interface PlayerManagementModalProps {
  clubDayId: string;
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface PlayerDetails {
  player: Player;
  seats: Array<{ seatId: string; tableId: string; tableNumber: number; seatedAt: string }>;
  waitlists: Array<{ waitlistId: string; tableId: string; tableNumber: number; addedAt: string }>;
  checkIns: number;
}

export default function PlayerManagementModal({ clubDayId, adminUser, onClose, onSuccess }: PlayerManagementModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedPlayer, setEditedPlayer] = useState<Partial<Player>>({});
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const [showPruneConfirm, setShowPruneConfirm] = useState(false);
  const [pruneResults, setPruneResults] = useState<{ deleted: number; errors: string[] } | null>(null);
  const [inactivePlayersPreview, setInactivePlayersPreview] = useState<Player[]>([]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setError('');
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setError('');
    
    searchPlayers(query)
      .then((results) => {
        // Only update if query hasn't changed
        if (searchQuery.trim() !== query) {
          return;
        }
        
        // Force a new array reference to ensure React detects the change
        setSearchResults([...results]);
        
        if (results.length === 0) {
          setError('No players found');
        } else {
          setError(''); // Clear error on success
        }
      })
      .catch((err: any) => {
        // Only update if query hasn't changed
        if (searchQuery.trim() !== query) return;
        setError(err?.message || 'Search failed');
        setSearchResults([]);
      })
      .finally(() => {
        // Only update if query hasn't changed
        if (searchQuery.trim() === query) {
          setIsSearching(false);
        }
      });
  }, [searchQuery]);


  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError('Please enter a search query');
      return;
    }

    setLoading(true);
    setError('');
    setShowAllPlayers(false);
    try {
      const results = await searchPlayers(searchQuery);
      setSearchResults(results);
      if (results.length === 0) {
        setError('No players found');
      }
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleListAllPlayers = async () => {
    setLoading(true);
    setError('');
    setSearchQuery('');
    setShowAllPlayers(true);
    setSelectedPlayer(null);
    try {
      const allPlayers = await getAllPlayers();
      setSearchResults(allPlayers);
      if (allPlayers.length === 0) {
        setError('No players found in database');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load all players');
      setShowAllPlayers(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewInactivePlayers = async () => {
    setLoading(true);
    setError('');
    try {
      const inactive = await findInactivePlayers(6);
      setInactivePlayersPreview(inactive);
      setShowPruneConfirm(true);
      if (inactive.length === 0) {
        setError('No inactive players found (all players have checked in within the last 6 months)');
        setShowPruneConfirm(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to find inactive players');
    } finally {
      setLoading(false);
    }
  };

  const handlePruneInactivePlayers = async () => {
    setLoading(true);
    setError('');
    try {
      const results = await pruneInactivePlayers(adminUser, 6);
      setPruneResults(results);
      // Refresh the search results if showing all players
      if (showAllPlayers) {
        await handleListAllPlayers();
      }
      setShowPruneConfirm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to prune inactive players');
    } finally {
      setLoading(false);
    }
  };

  const loadPlayerDetails = async (player: Player) => {
    setLoading(true);
    setError('');
    try {
      const client = getClient();
      
      // Get seats
      const seatsData = await getSeatedPlayersForPlayer(player.id, clubDayId);
      const seats = await Promise.all(
        seatsData.map(async (seat) => {
          let tableNumber = 0;
          try {
            const { data: tableData } = await client.models.PokerTable.get({ id: seat.table_id });
            tableNumber = tableData?.tableNumber || 0;
          } catch {
            // ignore
          }
          return {
            seatId: seat.id,
            tableId: seat.table_id,
            tableNumber,
            seatedAt: seat.seated_at,
          };
        })
      );

      // Get waitlists
      const { data: waitlistData } = await client.models.TableWaitlist.list({
        filter: {
          and: [
            { playerId: { eq: player.id } },
            { clubDayId: { eq: clubDayId } },
            { removedAt: { attributeExists: false } },
          ],
        },
      });
      const waitlists = await Promise.all(
        (waitlistData || []).map(async (wl: any) => {
          let tableNumber = 0;
          try {
            const { data: tableData } = await client.models.PokerTable.get({ id: wl.tableId });
            tableNumber = tableData?.tableNumber || 0;
          } catch {
            // ignore
          }
          return {
            waitlistId: wl.id,
            tableId: wl.tableId,
            tableNumber,
            addedAt: wl.addedAt,
          };
        })
      );

      // Get check-ins count
      const { data: checkInsData } = await client.models.CheckIn.list({
        filter: {
          and: [
            { playerId: { eq: player.id } },
            { clubDayId: { eq: clubDayId } },
          ],
        },
      });
      const checkIns = checkInsData?.length || 0;

      setSelectedPlayer({
        player,
        seats,
        waitlists,
        checkIns,
      });
      setEditedPlayer({
        name: player.name,
        nick: player.nick,
        phone: player.phone,
        email: player.email,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load player details');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromSeat = async (seatId: string, tableId: string) => {
    if (!confirm('Remove player from this seat?')) return;
    setLoading(true);
    try {
      await removePlayerFromSeat(seatId, tableId, adminUser);
      // Reload player details
      if (selectedPlayer) {
        await loadPlayerDetails(selectedPlayer.player);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to remove from seat');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromWaitlist = async (waitlistId: string) => {
    if (!confirm('Remove player from this waitlist?')) return;
    setLoading(true);
    try {
      const client = getClient();
      await client.models.TableWaitlist.update({
        id: waitlistId,
        removedAt: new Date().toISOString(),
      });
      // Reload player details
      if (selectedPlayer) {
        await loadPlayerDetails(selectedPlayer.player);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to remove from waitlist');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePlayer = async () => {
    if (!selectedPlayer || !editedPlayer.name || !editedPlayer.nick) {
      setError('Name and nickname are required');
      return;
    }

    setLoading(true);
    try {
      const client = getClient();
      await client.models.Player.update({
        id: selectedPlayer.player.id,
        name: editedPlayer.name,
        nick: editedPlayer.nick,
        phone: editedPlayer.phone || undefined,
        email: editedPlayer.email || undefined,
      });
      // Reload player details
      const { data: updatedPlayer } = await client.models.Player.get({ id: selectedPlayer.player.id });
      if (updatedPlayer) {
        await loadPlayerDetails({
          id: updatedPlayer.id,
          name: updatedPlayer.name,
          nick: updatedPlayer.nick,
          phone: updatedPlayer.phone || undefined,
          email: updatedPlayer.email || undefined,
          created_at: updatedPlayer.createdAt,
          updated_at: updatedPlayer.updatedAt,
        });
      }
      setEditMode(false);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to update player');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlayer = async () => {
    if (!selectedPlayer) return;
    
    if (!confirm(`DANGER: Delete player "${selectedPlayer.player.nick}"? This cannot be undone and will remove all related data.`)) {
      return;
    }

    if (!confirm('Are you absolutely sure? This will delete all seats, waitlist entries, check-ins, and receipts for this player.')) {
      return;
    }

    setLoading(true);
    try {
      const client = getClient();
      
      // Remove from all seats
      for (const seat of selectedPlayer.seats) {
        await removePlayerFromSeat(seat.seatId, seat.tableId, adminUser);
      }
      
      // Remove from all waitlists
      for (const wl of selectedPlayer.waitlists) {
        await client.models.TableWaitlist.update({
          id: wl.waitlistId,
          removedAt: new Date().toISOString(),
        });
      }
      
      // Delete player
      await client.models.Player.delete({ id: selectedPlayer.player.id });
      
      setSelectedPlayer(null);
      setSearchResults(searchResults.filter(p => p.id !== selectedPlayer.player.id));
      onSuccess();
      alert('Player deleted successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to delete player');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content player-management-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Player Management</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="search-section">
            <div className="search-bar">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by name or nickname..."
                autoFocus
              />
              <button onClick={handleSearch} disabled={loading || searchQuery.trim().length < 2}>
                {loading || isSearching ? 'Searching...' : 'Search'}
              </button>
              <button className="btn-list-all" onClick={handleListAllPlayers} disabled={loading}>
                {loading ? 'Loading...' : 'List All Players'}
              </button>
            </div>

            <div className="search-bar" style={{ marginTop: '0.75rem', justifyContent: 'flex-start' }}>
              <button 
                className="btn-secondary" 
                onClick={handlePreviewInactivePlayers} 
                disabled={loading}
                style={{ background: '#ef4444', color: 'white' }}
              >
                {loading ? 'Checking...' : 'Prune Inactive Players (6+ months)'}
              </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            {pruneResults && (
              <div className={pruneResults.errors.length > 0 ? 'warning-box' : 'success-message'} style={{ marginTop: '1rem', padding: '1rem' }}>
                <h4>Prune Results:</h4>
                <p><strong>Deleted:</strong> {pruneResults.deleted} player(s)</p>
                {pruneResults.errors.length > 0 && (
                  <div>
                    <p><strong>Errors:</strong></p>
                    <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                      {pruneResults.errors.map((err, idx) => (
                        <li key={idx} style={{ fontSize: '0.9rem' }}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {showPruneConfirm && inactivePlayersPreview.length > 0 && (
              <div className="warning-box" style={{ marginTop: '1rem', padding: '1rem' }}>
                <h4>Confirm Prune Operation</h4>
                <p>This will permanently delete <strong>{inactivePlayersPreview.length} player(s)</strong> who haven't checked in for 6+ months:</p>
                <div style={{ maxHeight: '200px', overflowY: 'auto', marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.1)', borderRadius: '4px' }}>
                  {inactivePlayersPreview.slice(0, 20).map((p) => (
                    <div key={p.id} style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                      • {p.nick} {p.name !== p.nick && `(${p.name})`}
                    </div>
                  ))}
                  {inactivePlayersPreview.length > 20 && (
                    <div style={{ fontSize: '0.9rem', fontStyle: 'italic', marginTop: '0.5rem' }}>
                      ... and {inactivePlayersPreview.length - 20} more
                    </div>
                  )}
                </div>
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className="btn-danger" 
                    onClick={handlePruneInactivePlayers} 
                    disabled={loading}
                  >
                    {loading ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                  <button 
                    onClick={() => {
                      setShowPruneConfirm(false);
                      setInactivePlayersPreview([]);
                    }}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {searchResults.length > 0 && !selectedPlayer && (
              <div className="search-results">
                <p className="results-count">
                  {showAllPlayers ? 'All Players' : 'Found'} {searchResults.length} player(s)
                  {showAllPlayers && <span className="all-players-badge">All Players</span>}
                </p>
                <div className="results-list">
                  {searchResults.map((player) => (
                    <div key={player.id} className="player-item" onClick={() => loadPlayerDetails(player)}>
                      <strong>{player.nick}</strong>
                      {player.name !== player.nick && <span> ({player.name})</span>}
                      <div className="player-id">ID: {player.id}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selectedPlayer && (
            <div className="player-details">
              <button className="back-button" onClick={() => setSelectedPlayer(null)}>
                ← Back to search
              </button>

              <div className="detail-section">
                <h3>Player Information</h3>
                {editMode ? (
                  <div className="edit-form">
                    <div className="form-group">
                      <label>Name *</label>
                      <input
                        value={editedPlayer.name || ''}
                        onChange={(e) => setEditedPlayer({ ...editedPlayer, name: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Nickname *</label>
                      <input
                        value={editedPlayer.nick || ''}
                        onChange={(e) => setEditedPlayer({ ...editedPlayer, nick: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input
                        value={editedPlayer.phone || ''}
                        onChange={(e) => setEditedPlayer({ ...editedPlayer, phone: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        value={editedPlayer.email || ''}
                        onChange={(e) => setEditedPlayer({ ...editedPlayer, email: e.target.value })}
                      />
                    </div>
                    <div className="edit-actions">
                      <button onClick={handleUpdatePlayer} disabled={loading}>
                        {loading ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button onClick={() => setEditMode(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="info-display">
                    <p><strong>Name:</strong> {selectedPlayer.player.name}</p>
                    <p><strong>Nickname:</strong> {selectedPlayer.player.nick}</p>
                    <p><strong>Player ID:</strong> {selectedPlayer.player.id}</p>
                    {selectedPlayer.player.phone && <p><strong>Phone:</strong> {selectedPlayer.player.phone}</p>}
                    {selectedPlayer.player.email && <p><strong>Email:</strong> {selectedPlayer.player.email}</p>}
                    <button onClick={() => setEditMode(true)}>Edit Info</button>
                  </div>
                )}
              </div>

              <div className="detail-section">
                <h3>Current Status</h3>
                <p><strong>Check-ins today:</strong> {selectedPlayer.checkIns}</p>
                
                {selectedPlayer.seats.length > 0 && (
                  <div className="status-group">
                    <h4>Seated at {selectedPlayer.seats.length} table(s):</h4>
                    {selectedPlayer.seats.length > 1 && (
                      <div className="warning-box">
                        DOUBLE-SEATING DETECTED! Player is at multiple tables.
                      </div>
                    )}
                    {selectedPlayer.seats.map((seat) => (
                      <div key={seat.seatId} className="status-item">
                        <span>Table {seat.tableNumber} - Seated: {new Date(seat.seatedAt).toLocaleString()}</span>
                        <button onClick={() => handleRemoveFromSeat(seat.seatId, seat.tableId)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedPlayer.waitlists.length > 0 && (
                  <div className="status-group">
                    <h4>On waitlist at {selectedPlayer.waitlists.length} table(s):</h4>
                    {selectedPlayer.waitlists.map((wl) => (
                      <div key={wl.waitlistId} className="status-item">
                        <span>Table {wl.tableNumber} - Added: {new Date(wl.addedAt).toLocaleString()}</span>
                        <button onClick={() => handleRemoveFromWaitlist(wl.waitlistId)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedPlayer.seats.length === 0 && selectedPlayer.waitlists.length === 0 && (
                  <p className="no-status">Not currently seated or on any waitlist</p>
                )}
              </div>

              <div className="danger-section">
                <h3>Danger Zone</h3>
                <button className="btn-danger" onClick={handleDeletePlayer} disabled={loading}>
                  {loading ? 'Deleting...' : 'Delete Player Permanently'}
                </button>
                <p className="danger-note">
                  This will permanently delete the player and all related data. This action cannot be undone.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
