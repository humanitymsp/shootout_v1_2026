import { useState } from 'react';
import type { PersistentTable, PersistentTableWaitlist } from '../types';
import './PersistentWaitlistModal.css';

interface PersistentWaitlistModalProps {
  table: PersistentTable;
  waitlist: PersistentTableWaitlist[];
  onClose: () => void;
  onAddPlayer: (playerName: string, playerPhone: string) => void;
  onRemovePlayer: (waitlistId: string) => void;
}

export default function PersistentWaitlistModal({
  table,
  waitlist,
  onClose,
  onAddPlayer,
  onRemovePlayer,
}: PersistentWaitlistModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [playerPhone, setPlayerPhone] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!playerName.trim() || !playerPhone.trim()) {
      alert('Please enter both name and phone number');
      return;
    }

    setIsAdding(true);
    try {
      onAddPlayer(playerName.trim(), playerPhone.trim());
      setPlayerName('');
      setPlayerPhone('');
      setShowAddForm(false);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemovePlayer = (waitlistId: string, playerName: string) => {
    if (window.confirm(`Remove ${playerName} from the waitlist?`)) {
      onRemovePlayer(waitlistId);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content persistent-waitlist-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-content">
            <h2>Waitlist Management</h2>
            <div className="table-info">
              <span className="table-number">Table {table.table_number}</span>
              <span className="game-type">{table.game_type}</span>
              <span className="stakes">{table.stakes_text}</span>
            </div>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="waitlist-stats">
            <div className="stat-item">
              <span className="stat-label">Total Players:</span>
              <span className="stat-value">{waitlist.length}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Table Capacity:</span>
              <span className="stat-value">{table.seats_total} seats</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Status:</span>
              <span className={`stat-value status-${table.status.toLowerCase()}`}>
                {table.status}
              </span>
            </div>
          </div>

          <div className="waitlist-actions">
            <button 
              className="add-player-btn"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? 'Cancel' : '+ Add Player to Waitlist'}
            </button>
          </div>

          {showAddForm && (
            <form className="add-player-form" onSubmit={handleAddPlayer}>
              <h3>Add Player to Waitlist</h3>
              <div className="form-group">
                <label>Player Name *</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter player name"
                  required
                  maxLength={50}
                />
              </div>
              <div className="form-group">
                <label>Phone Number *</label>
                <input
                  type="tel"
                  value={playerPhone}
                  onChange={(e) => setPlayerPhone(e.target.value)}
                  placeholder="Enter phone number"
                  required
                  pattern="[0-9\-\s\(\)]+"
                />
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => setShowAddForm(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={isAdding}>
                  {isAdding ? 'Adding...' : 'Add to Waitlist'}
                </button>
              </div>
            </form>
          )}

          <div className="waitlist-section">
            <h3>Current Waitlist ({waitlist.length})</h3>
            {waitlist.length === 0 ? (
              <div className="empty-waitlist">
                <p>No players are currently on the waitlist.</p>
                {table.public_signups && (
                  <p>Players can sign up from the public page when public signups are enabled.</p>
                )}
              </div>
            ) : (
              <div className="waitlist-grid">
                {waitlist.map((player) => (
                  <div key={player.id} className="waitlist-player-card">
                    <div className="player-position">
                      <span className="position-number">#{player.position}</span>
                    </div>
                    <div className="player-info">
                      <h4>{player.player_name}</h4>
                      <p className="phone">{player.player_phone}</p>
                      <p className="added-date">
                        Added: {new Date(player.added_at).toLocaleDateString()} at {new Date(player.added_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="player-actions">
                      <button 
                        className="remove-btn"
                        onClick={() => handleRemovePlayer(player.id, player.player_name)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="close-footer-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
