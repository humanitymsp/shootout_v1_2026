import { useState, useEffect } from 'react';
import { searchPlayersLocal } from '../lib/localStoragePlayers';
import {
  getHighHand,
  isHighHandEnabled,
  setHighHandEnabled,
  startNewRound,
  updateCurrentHand,
  declareWinner,
  clearHighHand,
  getHighHandWinners,
  getRemainingTimeMs,
  isRoundExpired,
} from '../lib/highHand';
import type { HighHand, HighHandWinner, CardCode } from '../lib/highHand';
import type { Player } from '../types';
import PlayingCard, { CardPicker } from './PlayingCard';
import { showToast } from './Toast';
import { log } from '../lib/logger';
import './HighHandModal.css';

interface HighHandModalProps {
  onClose: () => void;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function HighHandModal({ onClose }: HighHandModalProps) {
  const [enabled, setEnabled] = useState(isHighHandEnabled());
  const [currentHand, setCurrentHand] = useState<HighHand | null>(getHighHand());
  const [winners, setWinners] = useState<HighHandWinner[]>(getHighHandWinners());
  const [remaining, setRemaining] = useState(getRemainingTimeMs());

  // Form state
  const [playerSearch, setPlayerSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [handDescription, setHandDescription] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [customDuration, setCustomDuration] = useState('60'); // minutes
  const [selectedCards, setSelectedCards] = useState<CardCode[]>([]);

  // Countdown timer
  useEffect(() => {
    if (!currentHand || !enabled) return;
    const interval = setInterval(() => {
      const ms = getRemainingTimeMs();
      setRemaining(ms);
      if (ms <= 0) {
        // Round expired — auto-declare winner
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [currentHand, enabled]);

  // Player search
  useEffect(() => {
    if (playerSearch.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const results = searchPlayersLocal(playerSearch.trim());
    setSearchResults(results.slice(0, 8));
  }, [playerSearch]);

  const handleToggleEnabled = () => {
    const newVal = !enabled;
    setEnabled(newVal);
    setHighHandEnabled(newVal);
    if (!newVal) {
      setCurrentHand(null);
    }
    showToast(newVal ? 'High Hand feature enabled' : 'High Hand feature disabled', 'success');
  };

  const handleSetHand = () => {
    const playerName = selectedPlayer?.nick || selectedPlayer?.name || playerSearch.trim();
    if (!playerName) {
      showToast('Enter a player name', 'error');
      return;
    }
    if (!handDescription.trim()) {
      showToast('Enter the hand description', 'error');
      return;
    }

    const tNum = tableNumber ? parseInt(tableNumber, 10) : undefined;
    const durationMs = (parseInt(customDuration, 10) || 60) * 60 * 1000;

    if (currentHand && !isRoundExpired()) {
      // Update existing round — clock keeps running
      const updated = updateCurrentHand(playerName, handDescription.trim(), {
        playerId: selectedPlayer?.id,
        tableNumber: tNum,
        cards: selectedCards.length > 0 ? selectedCards : undefined,
      });
      if (updated) {
        setCurrentHand(updated);
        showToast(`High hand updated: ${playerName} — ${handDescription.trim()}`, 'success');
        log(`[HighHand] Updated: ${playerName} — ${handDescription.trim()}`);
      }
    } else {
      // Start new round
      const hand = startNewRound(playerName, handDescription.trim(), {
        playerId: selectedPlayer?.id,
        tableNumber: tNum,
        durationMs,
        cards: selectedCards.length > 0 ? selectedCards : undefined,
      });
      setCurrentHand(hand);
      setRemaining(durationMs);
      showToast(`High hand round started: ${playerName} — ${handDescription.trim()}`, 'success');
      log(`[HighHand] New round: ${playerName} — ${handDescription.trim()} (${customDuration} min)`);
    }

    // Reset form
    setPlayerSearch('');
    setSelectedPlayer(null);
    setHandDescription('');
    setTableNumber('');
    setSelectedCards([]);
    setSearchResults([]);
  };

  const handleDeclareWinner = () => {
    const winner = declareWinner();
    if (winner) {
      setCurrentHand(null);
      setWinners(getHighHandWinners());
      showToast(`🏆 High Hand Winner: ${winner.playerName} — ${winner.handDescription}`, 'success');
      log(`[HighHand] Winner declared: ${winner.playerName} — ${winner.handDescription}`);
    }
  };

  const handleClearRound = () => {
    if (!confirm('Clear the current high hand round without declaring a winner?')) return;
    clearHighHand();
    setCurrentHand(null);
    showToast('High hand round cleared', 'success');
  };

  const expired = currentHand ? isRoundExpired() : false;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content high-hand-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🃏 High Hand</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Enable/Disable Toggle */}
          <div className="hh-toggle-section">
            <label className="hh-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={handleToggleEnabled}
              />
              <span className="hh-toggle-label">
                {enabled ? 'High Hand Active' : 'High Hand Disabled'}
              </span>
            </label>
            <p className="hh-toggle-help">
              When enabled, the high hand banner will appear on the TV display.
            </p>
          </div>

          {enabled && (
            <>
              {/* Current High Hand Status */}
              {currentHand && (
                <div className={`hh-current ${expired ? 'hh-expired' : ''}`}>
                  <div className="hh-current-header">
                    <span className="hh-current-title">
                      {expired ? '⏰ Round Expired' : '🔥 Current High Hand'}
                    </span>
                    <span className={`hh-countdown ${expired ? 'expired' : remaining < 300000 ? 'warning' : ''}`}>
                      {expired ? 'TIME UP' : formatCountdown(remaining)}
                    </span>
                  </div>
                  <div className="hh-current-details">
                    <div className="hh-current-player">{currentHand.playerName}</div>
                    <div className="hh-current-hand">{currentHand.handDescription}</div>
                    {currentHand.cards && currentHand.cards.length > 0 && (
                      <div className="hh-current-cards">
                        {currentHand.cards.map(c => <PlayingCard key={c} card={c} size="sm" />)}
                      </div>
                    )}
                    {currentHand.tableNumber && (
                      <div className="hh-current-table">Table {currentHand.tableNumber}</div>
                    )}
                  </div>
                  <div className="hh-current-actions">
                    <button className="hh-btn hh-btn-winner" onClick={handleDeclareWinner}>
                      🏆 Declare Winner
                    </button>
                    <button className="hh-btn hh-btn-clear" onClick={handleClearRound}>
                      Clear Round
                    </button>
                  </div>
                </div>
              )}

              {/* Set / Update High Hand Form */}
              <div className="hh-form-section">
                <h3 className="hh-form-title">
                  {currentHand && !expired ? 'Update High Hand (Better Hand Played)' : 'Start New High Hand Round'}
                </h3>

                <div className="hh-form-field">
                  <label>Player</label>
                  <input
                    type="text"
                    value={selectedPlayer ? (selectedPlayer.nick || selectedPlayer.name) : playerSearch}
                    onChange={(e) => {
                      setPlayerSearch(e.target.value);
                      if (selectedPlayer) setSelectedPlayer(null);
                    }}
                    placeholder="Search player name..."
                    className="hh-input"
                  />
                  {searchResults.length > 0 && !selectedPlayer && (
                    <div className="hh-search-results">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          className="hh-search-item"
                          onClick={() => {
                            setSelectedPlayer(p);
                            setPlayerSearch('');
                            setSearchResults([]);
                          }}
                        >
                          {p.nick || p.name}
                          {p.nick && p.name !== p.nick && (
                            <span className="hh-search-item-name"> ({p.name})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hh-form-field">
                  <label>Hand</label>
                  <input
                    type="text"
                    value={handDescription}
                    onChange={(e) => setHandDescription(e.target.value)}
                    placeholder="e.g. Aces Full of Kings, Quad Jacks..."
                    className="hh-input"
                  />
                </div>

                <CardPicker selected={selectedCards} onChange={setSelectedCards} maxCards={5} />

                <div className="hh-form-row">
                  <div className="hh-form-field hh-form-field-small">
                    <label>Table #</label>
                    <input
                      type="number"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      placeholder="Optional"
                      className="hh-input"
                    />
                  </div>
                  {!currentHand && (
                    <div className="hh-form-field hh-form-field-small">
                      <label>Duration (min)</label>
                      <input
                        type="number"
                        value={customDuration}
                        onChange={(e) => setCustomDuration(e.target.value)}
                        min="1"
                        max="180"
                        className="hh-input"
                      />
                    </div>
                  )}
                </div>

                <button
                  className="hh-btn hh-btn-submit"
                  onClick={handleSetHand}
                  disabled={!handDescription.trim() && !playerSearch.trim() && !selectedPlayer}
                >
                  {currentHand && !expired ? '🔄 Update High Hand' : '▶️ Start Round'}
                </button>
              </div>

              {/* Previous Winners */}
              {winners.length > 0 && (
                <div className="hh-winners-section">
                  <h3 className="hh-form-title">Previous Winners</h3>
                  <div className="hh-winners-list">
                    {winners.slice(0, 10).map((w, i) => (
                      <div key={i} className="hh-winner-item">
                        <span className="hh-winner-name">🏆 {w.playerName}</span>
                        <span className="hh-winner-hand">{w.handDescription}</span>
                        {w.tableNumber && <span className="hh-winner-table">Table {w.tableNumber}</span>}
                        <span className="hh-winner-time">
                          {new Date(w.wonAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
