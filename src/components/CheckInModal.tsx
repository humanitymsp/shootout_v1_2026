import { useState, useEffect, useRef, type RefObject } from 'react';
import { getCheckInForPlayer, createCheckIn, addPlayerToWaitlist, syncPlayerToDB } from '../lib/api';
import { searchPlayersLocal, createPlayerLocal, updatePlayerLocal } from '../lib/localStoragePlayers';
import { sendSMS, getSMSSettings } from '../lib/sms';
import type { Player } from '../types';
import { generateClient } from '../lib/graphql-client';
import { showToast } from './Toast';
import { log, logError } from '../lib/logger';
import './CheckInModal.css';

const client = generateClient();

interface CheckInModalProps {
  clubDayId: string;
  adminUser: string;
  tables: any[];
  onClose: () => void;
  onSuccess: () => void;
}

const SAVED_DOOR_FEES_KEY = 'saved-door-fees';

function loadSavedDoorFees(): number[] {
  try {
    const saved = localStorage.getItem(SAVED_DOOR_FEES_KEY);
    if (saved) {
      const fees = JSON.parse(saved);
      return Array.isArray(fees) ? fees.filter((f: any) => typeof f === 'number' && f > 0).sort((a, b) => b - a) : [];
    }
  } catch (error) {
    logError('Error loading saved door fees:', error);
  }
  return [];
}

function saveDoorFee(amount: number): void {
  try {
    const saved = loadSavedDoorFees();
    if (!saved.includes(amount)) {
      saved.push(amount);
      saved.sort((a, b) => b - a);
      localStorage.setItem(SAVED_DOOR_FEES_KEY, JSON.stringify(saved));
    }
  } catch (error) {
    logError('Error saving door fee:', error);
  }
}

function deleteSavedDoorFee(amount: number): void {
  try {
    const saved = loadSavedDoorFees();
    const filtered = saved.filter(f => f !== amount);
    localStorage.setItem(SAVED_DOOR_FEES_KEY, JSON.stringify(filtered));
  } catch (error) {
    logError('Error deleting door fee:', error);
  }
}

export default function CheckInModal({ clubDayId, adminUser, tables, onClose, onSuccess }: CheckInModalProps) {
  const [nick, setNick] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [doorFee, setDoorFee] = useState(20);
  const [customDoorFee, setCustomDoorFee] = useState('');
  const [savedDoorFees, setSavedDoorFees] = useState<number[]>([]);
  const [selectedGameTypes, setSelectedGameTypes] = useState<Set<string>>(new Set());
  const [tableList, setTableList] = useState<any[]>([]);
  const [enrichedTables, setEnrichedTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingCheckIn, setExistingCheckIn] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [useExistingBuyIn, setUseExistingBuyIn] = useState(false);
  const [playerNotFound, setPlayerNotFound] = useState(false);
  const [skipDoorFee, setSkipDoorFee] = useState(false);
  const [isPreviousPlayer, setIsPreviousPlayer] = useState(false);
  const [playerPhone, setPlayerPhone] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [smsSettings, setSmsSettings] = useState<any>(null);
  const [phoneRequired, setPhoneRequired] = useState(false);
  const [nicknameError, setNicknameError] = useState('');
  const gameTypeSectionRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  const scrollToRef = (ref: RefObject<HTMLDivElement>) => {
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  };

  // Load saved door fees on mount
  useEffect(() => {
    setSavedDoorFees(loadSavedDoorFees());
    
    // Load SMS settings to determine if phone is required
    const settings = getSMSSettings();
    console.log('SMS Settings loaded:', settings);
    console.log('Phone required:', settings.enabled && settings.checkInNotifications);
    setSmsSettings(settings);
    setPhoneRequired(settings.enabled && settings.checkInNotifications);
  }, []);

  // Pre-populate phone/email fields when a player is selected so state matches display
  useEffect(() => {
    if (selectedPlayer) {
      if (selectedPlayer.phone && !playerPhone) setPlayerPhone(selectedPlayer.phone);
      if (selectedPlayer.email && !playerEmail) setPlayerEmail(selectedPlayer.email);
    }
  }, [selectedPlayer]);

  // When a player is confirmed, scroll to the game type section
  useEffect(() => {
    if (selectedPlayer) {
      scrollToRef(gameTypeSectionRef);
    }
  }, [selectedPlayer]);

  // When a game type is selected, scroll to the footer so Submit is visible
  useEffect(() => {
    if (selectedGameTypes.size > 0) {
      scrollToRef(footerRef);
    }
  }, [selectedGameTypes]);

  useEffect(() => {
    setTableList(tables);
    enrichTablesWithCounts(tables);
  }, [tables]);

  useEffect(() => {
    if (tables.length === 0) return;
    const refreshInterval = setInterval(() => {
      if (document.hidden) return;
      enrichTablesWithCounts(tables);
    }, 8000);
    return () => clearInterval(refreshInterval);
  }, [tables]);

  const enrichTablesWithCounts = async (tableList: any[]) => {
    if (tableList.length === 0) {
      setEnrichedTables([]);
      return;
    }
    
    const enriched = await Promise.all(
      tableList.map(async (table) => {
        try {
          const [seatsRes, waitlistRes] = await Promise.all([
            client.models.TableSeat.list({
              filter: {
                and: [
                  { tableId: { eq: table.id } },
                  { leftAt: { attributeExists: false } },
                ],
              },
            }),
            client.models.TableWaitlist.list({
              filter: {
                and: [
                  { tableId: { eq: table.id } },
                  { removedAt: { attributeExists: false } },
                ],
              },
            }),
          ]);
          
          const actualSeated = (seatsRes.data || []).filter((s: any) => !s.id?.startsWith('temp-'));
          const actualWaitlist = (waitlistRes.data || []).filter((w: any) => !w.id?.startsWith('temp-'));
          
          return {
            ...table,
            seatsFilled: actualSeated.length,
            waitlistCount: actualWaitlist.length,
          };
        } catch (error) {
          logError('Error getting counts for table:', table.id, error);
          return {
            ...table,
            seatsFilled: 0,
            waitlistCount: 0,
          };
        }
      })
    );
    setEnrichedTables(enriched);
  };

  useEffect(() => {
    const query = nick.trim();
    if (query.length < 1) {
      setIsSearching(false);
      setSelectedPlayer(null);
      setPlayerNotFound(false);
      return;
    }

    if (selectedPlayer && selectedPlayer.nick.toLowerCase() !== query.toLowerCase()) {
      setSelectedPlayer(null);
      setPlayerNotFound(false);
    }

    if (selectedPlayer && selectedPlayer.nick.toLowerCase() === query.toLowerCase()) {
      setPlayerNotFound(false);
      return;
    }

    setIsSearching(true);
    setError('');
    setPlayerNotFound(false);
    
    const searchTimeout = setTimeout(async () => {
      if (nick.trim() !== query) {
        setIsSearching(false);
        return;
      }

      try {
        const results = searchPlayersLocal(query);
        
        if (nick.trim() !== query) {
          setIsSearching(false);
          return;
        }

        const exactMatch = results.find(p => p.nick.toLowerCase() === query.toLowerCase());
        
        if (exactMatch) {
          setSelectedPlayer(exactMatch);
          setPlayerNotFound(false);
        } else {
          setPlayerNotFound(true);
          setSelectedPlayer(null);
        }
      } catch (error: any) {
        logError('Search error:', error);
        if (nick.trim() !== query) {
          setIsSearching(false);
          return;
        }
        setError(error?.message || 'Search failed');
        setPlayerNotFound(false);
      } finally {
        if (nick.trim() === query) {
          setIsSearching(false);
        }
      }
    }, 800);

    return () => {
      clearTimeout(searchTimeout);
    };
  }, [nick]);

  useEffect(() => {
    if (selectedPlayer) {
      checkExistingCheckIn();
    } else {
      setExistingCheckIn(null);
      setShowOverride(false);
      setUseExistingBuyIn(false);
    }
  }, [selectedPlayer, clubDayId]);

  const checkExistingCheckIn = async () => {
    if (!selectedPlayer) return;
    const checkIn = await getCheckInForPlayer(selectedPlayer.id, clubDayId);
    setExistingCheckIn(checkIn);
    setUseExistingBuyIn(!!checkIn);
    setShowOverride(false);
  };

  const handleSaveCustomDoorFee = () => {
    const amount = parseFloat(customDoorFee);
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount to save', 'error');
      return;
    }
    saveDoorFee(amount);
    setSavedDoorFees(loadSavedDoorFees());
    showToast(`Saved $${amount.toFixed(2)} as custom door fee`, 'success');
  };

  const handleSelectSavedDoorFee = (amount: number) => {
    setDoorFee(-1);
    setCustomDoorFee(amount.toString());
  };

  const handleDeleteSavedDoorFee = (e: React.MouseEvent, amount: number) => {
    e.stopPropagation();
    deleteSavedDoorFee(amount);
    setSavedDoorFees(loadSavedDoorFees());
    showToast(`Removed $${amount.toFixed(2)} from saved fees`, 'success');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNicknameError('');

    try {
      let player = selectedPlayer;
      if (!player) {
        if (!nick.trim()) {
          setError('Player nickname is required');
          setLoading(false);
          return;
        }

        // Validate nickname length (max 9 characters)
        if (nick.trim().length > 9) {
          setError('Player nickname must be 9 characters or less');
          setLoading(false);
          return;
        }

        // Validate phone number if SMS notifications are enabled
        if (phoneRequired && !playerPhone.trim()) {
          setError('Phone number is required when SMS notifications are enabled');
          setLoading(false);
          return;
        }

        // Check for unique nickname if SMS notifications are enabled
        if (phoneRequired) {
          const existingPlayers = searchPlayersLocal(nick.trim());
          if (existingPlayers.length > 0) {
            setNicknameError(`Player "${nick.trim()}" already exists. Please use a different nickname.`);
            setLoading(false);
            return;
          }
        }
        
        try {
          player = createPlayerLocal({ 
            name: nick.trim(), 
            nick: nick.trim(),
            phone: playerPhone.trim() || undefined,
            email: playerEmail.trim() || undefined
          }, clubDayId);
          setSelectedPlayer(player);
          showToast(`Player "${nick.trim()}" created successfully`, 'success');

          // Persist to permanent DynamoDB Player record (fire-and-forget)
          if (playerPhone.trim()) {
            syncPlayerToDB({ nick: nick.trim(), phone: playerPhone.trim(), email: playerEmail.trim() || undefined }).catch(() => {});
          }
        } catch (createError: any) {
          setError(createError?.message || 'Failed to create player');
          setLoading(false);
          return;
        }
      }

      // Update player contact info if changed
      if (selectedPlayer && (playerPhone.trim() || playerEmail.trim())) {
        const updates: Partial<Player> = {};
        if (playerPhone.trim() && playerPhone.trim() !== selectedPlayer.phone) {
          updates.phone = playerPhone.trim();
        }
        if (playerEmail.trim() && playerEmail.trim() !== selectedPlayer.email) {
          updates.email = playerEmail.trim();
        }
        
        if (Object.keys(updates).length > 0) {
          try {
            const updatedPlayer = updatePlayerLocal(selectedPlayer.id, updates);
            if (updatedPlayer) player = updatedPlayer;
            setSelectedPlayer(updatedPlayer);
            log('Updated player contact info:', updates);

            // Sync phone update to permanent DynamoDB Player record (fire-and-forget)
            if (updates.phone) {
              syncPlayerToDB({ nick: selectedPlayer.nick, phone: updates.phone, email: updates.email || selectedPlayer.email }).catch(() => {});
            }
          } catch (updateError) {
            logError('Failed to update player contact info:', updateError);
            // Don't fail the check-in if contact update fails
          }
        }
      }

      if (existingCheckIn && !useExistingBuyIn && !overrideReason.trim()) {
        setError('Player already checked in. Choose an option or provide override reason.');
        setLoading(false);
        return;
      }

      if (selectedGameTypes.size === 0) {
        setError('Please select at least one game type');
        setLoading(false);
        return;
      }

      let result: any = null;

      if (isPreviousPlayer) {
        log('Previous player - creating $0 check-in for tracking');
        result = await createCheckIn(
          clubDayId,
          player.id,
          0,
          'cash',
          'Previous player - no door fee',
          adminUser
        );
        log('Previous player check-in created:', result);
      } else if (skipDoorFee) {
        log('Lobby waitlist mode - skipping door fee, player will pay when seated');
      } else if (useExistingBuyIn && existingCheckIn) {
        log('Using existing buy-in for player:', player.id);
      } else {
        const feeAmount = doorFee === -1 ? parseFloat(customDoorFee) : doorFee;
        if (isNaN(feeAmount) || feeAmount <= 0) {
          setError('Invalid door fee amount');
          setLoading(false);
          return;
        }

        log('Creating check-in with:', {
          clubDayId,
          playerId: player.id,
          feeAmount,
          overrideReason: overrideReason || undefined,
          adminUser
        });

        result = await createCheckIn(
          clubDayId,
          player.id,
          feeAmount,
          'cash',
          overrideReason || undefined,
          adminUser
        );

        log('Check-in created:', result);
      }

      // Add player to the lobby waitlist for each selected game type.
      // For each game type we add to ONE table (first active table) — the tablet/admin
      // lobby view merges and deduplicates waitlists across all tables of the same game
      // type, so the player appears in the correct game-type lobby.
      const addedGameLabels: string[] = [];
      const addedTableIds: string[] = [];
      for (const gameTypeKey of selectedGameTypes) {
        const gameTypeTables = tables.filter((t: any) => {
          const key = `${t.game_type || 'Other'}||${t.stakes_text || ''}`;
          return key === gameTypeKey && t.status !== 'CLOSED';
        });
        if (gameTypeTables.length === 0) continue;
        const lobbyTable = gameTypeTables[0];
        const [gameLabel] = gameTypeKey.split('||');
        log(`Adding player to ${gameLabel} lobby waitlist via Table ${lobbyTable.table_number}`);
        try {
          await addPlayerToWaitlist(lobbyTable.id, player.id, clubDayId, adminUser, { skipSeatCheck: true });
          log(`Added to ${gameLabel} lobby waitlist (Table ${lobbyTable.table_number})`);
          addedGameLabels.push(`${gameLabel}`);
          addedTableIds.push(lobbyTable.id);
        } catch (err: any) {
          logError(`Failed to add to ${gameLabel} lobby waitlist:`, err);
          // Don't fail the whole operation — just skip this one
          showToast(`Could not add to ${gameLabel} waitlist: ${err.message || 'already on it'}`, 'warning');
        }
      }
      if (addedGameLabels.length === 0) {
        setError('Failed to add player to any waitlists.');
        setLoading(false);
        return;
      }

      setReceipt(result?.receipt || existingCheckIn?.receipt);

      // Broadcast one update per table the player was actually added to
      // so only the correct TableCard(s) react with optimistic updates
      for (const addedTableId of addedTableIds) {
        const updatePayload = { 
          type: 'player-update', 
          action: 'checkin', 
          playerId: player.id,
          tableId: addedTableId,
          gameType: Array.from(selectedGameTypes).join(','),
          clubDayId: clubDayId,
          assignmentMode: 'waitlist',
          playerData: player,
        };
        try {
          const channel = new BroadcastChannel('admin-updates');
          channel.postMessage(updatePayload);
          channel.close();
        } catch {
          // BroadcastChannel not available
        }
        window.dispatchEvent(new CustomEvent('player-update', { detail: updatePayload }));
      }
      
      // Send SMS notification if enabled and player has phone number
      const smsCfg = getSMSSettings();
      const smsPhone = player.phone || playerPhone.trim();
      if (smsCfg.enabled && !smsCfg.apiKey) {
        showToast('SMS not sent: API key not saved. Open SMS Settings and click Save.', 'warning');
      }
      if (smsCfg.enabled && smsCfg.apiKey && smsPhone) {
        try {
          const gameLabelsForSMS = addedGameLabels.join(', ');
          let smsMsg = `Hi ${player.nick}! You're checked in for ${gameLabelsForSMS}`;
          smsMsg += ` and on the waitlist`;
          smsMsg += `. Good luck! - Final Table Poker Club`;

          showToast(`Sending SMS to ${smsPhone}…`, 'info');
          const smsResult = await sendSMS({ to: smsPhone, message: smsMsg }, smsCfg.apiKey);
          if (smsResult.success) {
            showToast(`SMS sent ✓ (${smsPhone})`, 'success');
            log('[CheckIn] SMS sent to', smsPhone);
          } else {
            logError('[CheckIn] SMS failed:', smsResult.error);
            showToast(`SMS failed: ${smsResult.error} (${smsPhone})`, 'error');
          }
        } catch (smsError) {
          logError('[CheckIn] SMS notification error:', smsError);
        }
      } else if (smsCfg.enabled && smsCfg.apiKey && !smsPhone) {
        showToast(`SMS skipped: no phone number for ${player.nick}`, 'warning');
      }
      
      localStorage.setItem('player-updated', new Date().toISOString());
      onSuccess();

      if (!keepOpen) {
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setSelectedPlayer(null);
        setNick('');
        setDoorFee(20);
        setCustomDoorFee('');
        setSelectedGameTypes(new Set());
        setExistingCheckIn(null);
        setOverrideReason('');
        setShowOverride(false);
        setUseExistingBuyIn(false);
        setReceipt(null);
        setLoading(false);
      }
    } catch (err: any) {
      logError('Check-in error:', err);
      setError(err.message || 'Failed to check in player');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content checkin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Sign In Player</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" ref={modalBodyRef}>
          <form id="checkin-form" onSubmit={handleSubmit} className="checkin-form">
            {/* Player Search Section */}
            <div className="form-section">
              <label className="form-label required">Player Nickname</label>
              <div className="search-wrapper">
                <input
                  type="text"
                  value={nick}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    // Limit to 13 characters
                    if (value.length <= 13) {
                      setNick(value);
                      if (value !== selectedPlayer?.nick) {
                        setSelectedPlayer(null);
                        setPlayerNotFound(false);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && selectedPlayer && selectedGameTypes.size > 0) {
                      handleSubmit(e);
                    }
                  }}
                  required
                  placeholder="Enter player nickname (max 13 characters)"
                  autoComplete="off"
                  autoFocus
                  className={`player-input ${nick.length > 13 ? 'error' : ''}`}
                  maxLength={13}
                />
                <span className={`character-counter ${nick.length > 13 ? 'error' : ''}`}>
                  {nick.length}/13
                </span>
                {isSearching && <span className="search-indicator">...</span>}
              </div>

              {selectedPlayer && (
                <div className="player-badge">
                  <span className="player-name">{selectedPlayer.nick}</span>
                  {selectedPlayer.name !== selectedPlayer.nick && (
                    <span className="player-fullname">{selectedPlayer.name}</span>
                  )}
                  <button type="button" className="clear-btn" onClick={() => { setSelectedPlayer(null); setNick(''); setPlayerNotFound(false); }} title="Clear selection">×</button>
                </div>
              )}
              {playerNotFound && nick.trim().length >= 1 && (
                <div className="info-badge">Player not found. Click "Sign In Player" to create them.</div>
              )}
              {isSearching && nick.trim().length >= 1 && !selectedPlayer && (
                <div className="searching-indicator">Looking up player...</div>
              )}
            </div>

            {/* Contact Information Section */}
            {(selectedPlayer || phoneRequired) && (
              <div className="form-section">
                <label className="form-label">
                  Contact Information {phoneRequired && <span className="required">*</span>}
                </label>
                <div className="contact-fields">
                  <div className="contact-field">
                    <input
                      type="tel"
                      value={playerPhone || selectedPlayer?.phone || ''}
                      onChange={(e) => setPlayerPhone(e.target.value)}
                      placeholder={phoneRequired ? "Phone number (required)" : "Phone number"}
                      className="contact-input"
                      required={phoneRequired}
                    />
                  </div>
                  <div className="contact-field">
                    <input
                      type="email"
                      value={playerEmail || selectedPlayer?.email || ''}
                      onChange={(e) => setPlayerEmail(e.target.value)}
                      placeholder="Email address"
                      className="contact-input"
                    />
                  </div>
                </div>
                <p className="form-help">
                  {phoneRequired 
                    ? "Phone number required for SMS notifications. Nickname must be unique." 
                    : "Add contact info for SMS notifications and marketing"}
                </p>
              </div>
            )}

            {/* Show nickname error if exists */}
            {nicknameError && (
              <div className="error-section">
                <div className="error-message">{nicknameError}</div>
              </div>
            )}

            {/* Existing Check-in Warning */}
            {existingCheckIn && (
              <div className="warning-section">
                <div className="warning-header"><span>⚠️</span><strong>Already Checked In</strong></div>
                <div className="warning-info">
                  <div>Paid: {new Date(existingCheckIn.checkin_time).toLocaleString()}</div>
                  <div>Receipt: #{existingCheckIn.receipt?.receipt_number}</div>
                </div>
                <div className="radio-group">
                  <label className="radio-option">
                    <input type="radio" name="buyinChoice" checked={useExistingBuyIn} onChange={() => { setUseExistingBuyIn(true); setShowOverride(false); setOverrideReason(''); }} />
                    <span>Use existing buy-in</span>
                  </label>
                  <label className="radio-option">
                    <input type="radio" name="buyinChoice" checked={!useExistingBuyIn && showOverride} onChange={() => { setUseExistingBuyIn(false); setShowOverride(true); }} />
                    <span>Charge again</span>
                  </label>
                </div>
                {showOverride && !useExistingBuyIn && (
                  <input type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason for charging again..." required className="override-input" />
                )}
              </div>
            )}

            {/* Previous Player checkbox */}
            <div className="form-section">
              <label className="previous-player-toggle">
                <input
                  type="checkbox"
                  checked={isPreviousPlayer}
                  onChange={(e) => {
                    setIsPreviousPlayer(e.target.checked);
                    if (e.target.checked) setSkipDoorFee(false);
                  }}
                />
                <span className="previous-player-label">Previous Player</span>
                <span className="previous-player-hint">No door fee collected</span>
              </label>
            </div>

            {/* Door Fee Section */}
            {!(existingCheckIn && useExistingBuyIn) && !isPreviousPlayer && (
              <div className="form-section">
                <div className="door-fee-label-row">
                  <label className="form-label">Door Fee</label>
                  <label className="skip-fee-toggle">
                    <input type="checkbox" checked={skipDoorFee} onChange={(e) => setSkipDoorFee(e.target.checked)} />
                    <span>Skip — collect later</span>
                  </label>
                </div>
                <div className={`fee-buttons${skipDoorFee ? ' fee-buttons-hidden' : ''}`}>
                  <button type="button" className={`fee-btn ${doorFee === 20 ? 'active' : ''}`} onClick={() => { setDoorFee(20); setCustomDoorFee(''); }}>$20</button>
                  <button type="button" className={`fee-btn ${doorFee === -1 ? 'active' : ''}`} onClick={() => setDoorFee(-1)}>Custom</button>
                  {savedDoorFees.length > 0 && savedDoorFees.map((amount) => {
                    const isSavedSelected = doorFee === -1 && customDoorFee === amount.toString();
                    return (
                      <button key={amount} type="button" className={`saved-fee-btn ${isSavedSelected ? 'active' : ''}`} onClick={() => handleSelectSavedDoorFee(amount)} title={`Select $${amount.toFixed(2)}`}>
                        ${amount.toFixed(2)}
                        <span role="button" className="saved-fee-delete" onClick={(e) => handleDeleteSavedDoorFee(e, amount)} title={`Remove $${amount.toFixed(2)}`} onMouseDown={(e) => e.stopPropagation()}>×</span>
                      </button>
                    );
                  })}
                </div>
                {doorFee === -1 && (
                  <div className="custom-fee-wrapper">
                    <div className="custom-fee-input-group">
                      <span className="custom-fee-currency">$</span>
                      <input type="number" step="0.01" min="0" value={customDoorFee} onChange={(e) => setCustomDoorFee(e.target.value)} placeholder="Enter amount" required className="custom-fee-input" />
                    </div>
                    {customDoorFee && parseFloat(customDoorFee) > 0 && !savedDoorFees.includes(parseFloat(customDoorFee)) && (
                      <button type="button" className="save-fee-btn" onClick={handleSaveCustomDoorFee} title="Save this amount for reuse">Save</button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Game Type Lobby Selection */}
            <div className="form-section" ref={gameTypeSectionRef}>
              <label className="form-label required">Game Type{selectedGameTypes.size > 1 ? 's' : ''}</label>
              <p className="form-help">Select one or more game types to add player to those waitlist lobbies.</p>
              <div className="game-type-buttons">
                {(() => {
                  const activeTables = (enrichedTables.length > 0 ? enrichedTables : tableList).filter((t: any) => t.status !== 'CLOSED');
                  const groups = new Map<string, { gameType: string; stakes: string; tableCount: number; totalSeats: number; totalSeated: number; totalWaiting: number }>();
                  for (const table of activeTables) {
                    const gameType = table.game_type || 'Other';
                    const stakes = table.stakes_text || '';
                    const groupKey = `${gameType}||${stakes}`;
                    const existing = groups.get(groupKey);
                    const seatsFilled = table.seatsFilled ?? 0;
                    const waitlistCount = table.waitlistCount ?? 0;
                    const seatsTotal = (table as any).seatsTotal ?? table.seats_total ?? 9;
                    if (existing) {
                      existing.tableCount++;
                      existing.totalSeats += seatsTotal;
                      existing.totalSeated += seatsFilled;
                      existing.totalWaiting += waitlistCount;
                    } else {
                      groups.set(groupKey, { gameType, stakes, tableCount: 1, totalSeats: seatsTotal, totalSeated: seatsFilled, totalWaiting: waitlistCount });
                    }
                  }
                  if (groups.size === 0) {
                    return <div className="info-badge">No active tables. Add tables in the admin panel first.</div>;
                  }
                  return Array.from(groups.entries()).map(([key, group]) => (
                    <button
                      key={key}
                      type="button"
                      className={`game-type-btn ${selectedGameTypes.has(key) ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedGameTypes(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) {
                            next.delete(key);
                          } else {
                            next.add(key);
                          }
                          return next;
                        });
                      }}
                    >
                      <span className="game-type-name">{group.gameType} {group.stakes}</span>
                      <span className="game-type-info">
                        {group.tableCount} table{group.tableCount !== 1 ? 's' : ''} · {group.totalSeated}/{group.totalSeats} seats · {group.totalWaiting} waiting
                      </span>
                    </button>
                  ));
                })()}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="error-message">{error}</div>
            )}

            {/* Receipt Ready */}
            {receipt && (
              <div className="receipt-section">
                <h3>Receipt Ready</h3>
                <p>Receipt #{receipt.receipt_number}</p>
                <button type="button" onClick={() => window.print()}>Print</button>
              </div>
            )}
          </form>
        </div>

        <div className="modal-footer" ref={footerRef}>
          <div className="footer-actions">
            <button 
              type="submit" 
              form="checkin-form"
              disabled={loading || nick.trim().length < 1 || selectedGameTypes.size === 0 || !nick.trim()}
              className="submit-btn"
            >
              {loading ? 'Processing...' : playerNotFound ? `Create & Sign In "${nick.trim()}"` : 'Sign In Player'}
            </button>
            <div className="footer-options">
              <label className="keep-open-label">
                <input
                  type="checkbox"
                  checked={keepOpen}
                  onChange={(e) => setKeepOpen(e.target.checked)}
                />
                <span>Keep open</span>
              </label>
              <button type="button" onClick={onClose} disabled={loading} className="cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
