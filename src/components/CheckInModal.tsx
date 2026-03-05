import { useState, useEffect, useRef, type RefObject } from 'react';
import { getCheckInForPlayer, createCheckIn, addPlayerToWaitlist, getSeatedPlayersForTable, seatPlayer, getWaitlistForTable, syncPlayerToDB } from '../lib/api';
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

async function getWaitlistPosition(tableId: string, playerId: string, clubDayId: string): Promise<number | undefined> {
  try {
    const waitlist = await getWaitlistForTable(tableId, clubDayId);
    const position = waitlist.findIndex((w: any) => w.player_id === playerId);
    return position >= 0 ? position + 1 : undefined;
  } catch {
    return undefined;
  }
}

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
  const [selectedTableId, setSelectedTableId] = useState('');
  const [assignmentMode, setAssignmentMode] = useState<'seat' | 'waitlist'>('seat');
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
  const [isMultiTableMode, setIsMultiTableMode] = useState(false);
  const [additionalTableIds, setAdditionalTableIds] = useState<string[]>([]);
  const [skipDoorFee, setSkipDoorFee] = useState(false);
  const [isPreviousPlayer, setIsPreviousPlayer] = useState(false);
  const [playerPhone, setPlayerPhone] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [smsSettings, setSmsSettings] = useState<any>(null);
  const [phoneRequired, setPhoneRequired] = useState(false);
  const [nicknameError, setNicknameError] = useState('');
  const multiTableRef = useRef<HTMLDivElement>(null);
  const assignmentSectionRef = useRef<HTMLDivElement>(null);
  const tableSectionRef = useRef<HTMLDivElement>(null);
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

  // Scroll to multi-table section when enabled
  useEffect(() => {
    if (isMultiTableMode && multiTableRef.current) {
      setTimeout(() => {
        multiTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [isMultiTableMode]);

  // When a player is confirmed, scroll to the door fee / assignment section
  useEffect(() => {
    if (selectedPlayer) {
      scrollToRef(assignmentSectionRef);
    }
  }, [selectedPlayer]);

  // When assignment mode changes, scroll to the table selector
  useEffect(() => {
    scrollToRef(tableSectionRef);
  }, [assignmentMode]);

  // When a table is selected, scroll to the footer so Submit is visible
  useEffect(() => {
    if (selectedTableId) {
      scrollToRef(footerRef);
    }
  }, [selectedTableId]);

  useEffect(() => {
    setTableList(tables);
    enrichTablesWithCounts(tables);
    if (selectedTableId && !tables.find(t => t.id === selectedTableId)) {
      setSelectedTableId('');
    }
  }, [tables, selectedTableId]);

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
    if (query.length < 2) {
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
          
          if (!selectedTableId && enrichedTables.length > 0) {
            const firstAvailableTable = enrichedTables.find(t => {
              const seatsFilled = t.seatsFilled ?? 0;
              const seatsTotal = t.seats_total ?? t.seatsTotal ?? 9;
              return seatsFilled < seatsTotal;
            });
            if (firstAvailableTable) {
              setSelectedTableId(firstAvailableTable.id);
              setAssignmentMode('seat');
            } else if (enrichedTables.length > 0) {
              setSelectedTableId(enrichedTables[0].id);
              setAssignmentMode('waitlist');
            }
          }
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

      if (!selectedTableId) {
        setError('Please select a table');
        setLoading(false);
        return;
      }

      let result: any = null;
      let broadcastTableId = selectedTableId;
      let broadcastAssignmentMode = assignmentMode;

      if (isPreviousPlayer) {
        log('Previous player - skipping door fee entirely');
      } else if (assignmentMode === 'waitlist' && skipDoorFee) {
        log('Waitlist mode - skipping door fee, player will pay when seated');
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

      if (assignmentMode === 'seat') {
        log('Assigning to seat at table:', selectedTableId);

        const selectedTable = tables.find(t => t.id === selectedTableId);
        if (!selectedTable) {
          setError('Selected table not found');
          setLoading(false);
          return;
        }
        
        // CRITICAL: Pass clubDayId to prevent counting seats from old club days
        const seatedPlayers = await getSeatedPlayersForTable(selectedTableId, clubDayId);
        const maxSeats = (selectedTable as any).seatsTotal ?? selectedTable.seats_total ?? 9;
        
        if (seatedPlayers.length >= maxSeats) {
          setError(`Table is full (${seatedPlayers.length}/${maxSeats} seats). Add player to waitlist instead.`);
          setLoading(false);
          return;
        }
        
        if (seatedPlayers.length > maxSeats) {
          setError(`Table capacity exceeded (${seatedPlayers.length}/${maxSeats} seats). Please remove excess players first.`);
          setLoading(false);
          return;
        }

        try {
          log('Seating player using seatPlayer API:', {
            tableId: selectedTableId,
            playerId: player.id,
            clubDayId,
          });

          await seatPlayer(selectedTableId, player.id, clubDayId);
          
          log('Player seated successfully');
        } catch (err: any) {
          logError('Seat creation failed:', err);
          
          if (err.message?.includes('already seated')) {
            setError(err.message);
            setLoading(false);
            return;
          } else if (err.message?.includes('full') || err.message?.includes('capacity')) {
            log('Table full, trying waitlist instead');
            try {
              await addPlayerToWaitlist(selectedTableId, player.id, clubDayId, adminUser);
              log('Player added to waitlist');
              broadcastAssignmentMode = 'waitlist';
            } catch (waitlistErr: any) {
              logError('Waitlist assignment failed:', waitlistErr);
              if (waitlistErr.message?.includes('already seated')) {
                setError('Cannot add to waitlist: Player is already seated at this table');
              } else {
                setError(`Failed to add to waitlist: ${waitlistErr.message || 'Unknown error'}`);
              }
              setLoading(false);
              return;
            }
          } else {
            setError(err.message || 'Failed to seat player');
            setLoading(false);
            return;
          }
        }
      } else if (assignmentMode === 'waitlist') {
        log('Adding to waitlist at table:', selectedTableId);
        try {
          await addPlayerToWaitlist(selectedTableId, player.id, clubDayId, adminUser);
          log('Player added to waitlist');
          broadcastAssignmentMode = 'waitlist';
        } catch (waitlistErr: any) {
          logError('Waitlist assignment failed:', waitlistErr);
          if (waitlistErr.message?.includes('already seated')) {
            setError('Cannot add to waitlist: Player is already seated at this table');
          } else {
            setError(`Failed to add to waitlist: ${waitlistErr.message}`);
          }
          setLoading(false);
          return;
        }
      }

      // Handle multi-table mode: add player to additional table waitlists
      if (isMultiTableMode && additionalTableIds.length > 0) {
        log('Multi-table mode: adding to additional waitlists:', additionalTableIds);
        const waitlistResults: { tableId: string; success: boolean; error?: string }[] = [];
        
        for (const tableId of additionalTableIds) {
          // Skip if it's the same as the primary table
          if (tableId === selectedTableId) continue;
          
          try {
            await addPlayerToWaitlist(tableId, player.id, clubDayId, adminUser, { skipSeatCheck: true });
            waitlistResults.push({ tableId, success: true });
            log(`Added to waitlist at table ${tableId}`);
          } catch (err: any) {
            logError(`Failed to add to waitlist at table ${tableId}:`, err);
            waitlistResults.push({ tableId, success: false, error: err.message });
          }
        }
        
        const successCount = waitlistResults.filter(r => r.success).length;
        const failCount = waitlistResults.filter(r => !r.success).length;
        
        if (successCount > 0) {
          showToast(`Added to ${successCount} additional waitlist${successCount > 1 ? 's' : ''}`, 'success');
        }
        if (failCount > 0) {
          showToast(`Failed to add to ${failCount} waitlist${failCount > 1 ? 's' : ''}`, 'warning');
        }
      }

      setReceipt(result?.receipt || existingCheckIn?.receipt);

      const updatePayload = { 
        type: 'player-update', 
        action: 'checkin', 
        playerId: player.id,
        tableId: broadcastTableId,
        clubDayId: clubDayId,
        assignmentMode: broadcastAssignmentMode,
        playerData: player,
      };
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage(updatePayload);
        channel.close();
      } catch {
        // BroadcastChannel not available
      }
      // Same-tab dispatch so TableCard in this window gets the optimistic update immediately
      // (BroadcastChannel only reaches other tabs)
      window.dispatchEvent(new CustomEvent('player-update', { detail: updatePayload }));
      
      // Send SMS notification if enabled and player has phone number
      const smsCfg = getSMSSettings();
      const smsPhone = player.phone || playerPhone.trim();
      console.error('[CheckIn-SMS-DEBUG]', JSON.stringify({
        enabled: smsCfg.enabled,
        hasApiKey: !!smsCfg.apiKey,
        apiKeyLength: smsCfg.apiKey?.length ?? 0,
        smsPhone: smsPhone || '(empty)',
        playerPhone: playerPhone || '(empty)',
        playerDotPhone: player?.phone || '(empty)',
      }));
      if (smsCfg.enabled && !smsCfg.apiKey) {
        showToast('SMS not sent: API key not saved. Open SMS Settings and click Save.', 'warning');
      }
      if (smsCfg.enabled && smsCfg.apiKey && smsPhone) {
        try {
          const tableInfo = tables.find(t => t.id === selectedTableId);
          const waitlistPosition = broadcastAssignmentMode === 'waitlist' ?
            await getWaitlistPosition(selectedTableId, player.id, clubDayId) : undefined;

          let smsMsg = `Hi ${player.nick}! You're checked in`;
          if (tableInfo?.table_number && tableInfo?.stakes_text) {
            smsMsg += ` at Table ${tableInfo.table_number} (${tableInfo.stakes_text})`;
          } else if (waitlistPosition) {
            smsMsg += ` and are #${waitlistPosition} on the waitlist`;
          }
          smsMsg += `. Good luck! - Final Table Poker Club`;

          showToast(`Sending SMS to ${smsPhone}…`, 'info');
          const smsResult = await sendSMS({ to: smsPhone, message: smsMsg }, smsCfg.apiKey);
          console.error('[CheckIn-SMS-RESULT]', JSON.stringify(smsResult));
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
        setSelectedTableId('');
        setAssignmentMode('seat');
        setExistingCheckIn(null);
        setOverrideReason('');
        setShowOverride(false);
        setUseExistingBuyIn(false);
        setReceipt(null);
        setLoading(false);
        setIsMultiTableMode(false);
        setAdditionalTableIds([]);
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
                    const value = e.target.value;
                    // Limit to 9 characters
                    if (value.length <= 9) {
                      setNick(value);
                      if (value !== selectedPlayer?.nick) {
                        setSelectedPlayer(null);
                        setPlayerNotFound(false);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && selectedPlayer && selectedTableId) {
                      handleSubmit(e);
                    }
                  }}
                  required
                  placeholder="Enter player nickname (max 9 characters)"
                  autoComplete="off"
                  autoFocus
                  className={`player-input ${nick.length > 9 ? 'error' : ''}`}
                  maxLength={9}
                />
                <span className={`character-counter ${nick.length > 9 ? 'error' : ''}`}>
                  {nick.length}/9
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
              {playerNotFound && nick.trim().length >= 2 && (
                <div className="info-badge">Player not found. Click "Sign In Player" to create them.</div>
              )}
              {isSearching && nick.trim().length >= 2 && !selectedPlayer && (
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
                  {assignmentMode === 'waitlist' && (
                    <label className="skip-fee-toggle">
                      <input type="checkbox" checked={skipDoorFee} onChange={(e) => setSkipDoorFee(e.target.checked)} />
                      <span>Skip — collect later</span>
                    </label>
                  )}
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

            {/* Assignment Mode Section */}
            <div className="form-section" ref={assignmentSectionRef}>
              <label className="form-label">Assignment</label>
              <div className="assignment-buttons">
                <button
                  type="button"
                  className={`assignment-btn ${assignmentMode === 'seat' ? 'active' : ''}`}
                  onClick={() => {
                    setAssignmentMode('seat');
                    setSkipDoorFee(false);
                  }}
                >
                  Seat
                </button>
                <button
                  type="button"
                  className={`assignment-btn ${assignmentMode === 'waitlist' ? 'active' : ''}`}
                  onClick={() => {
                    setAssignmentMode('waitlist');
                    setSkipDoorFee(false);
                  }}
                >
                  Waitlist
                </button>
              </div>
            </div>

            {/* Table Selection */}
            {(
              <div className="form-section" ref={tableSectionRef}>
                <label className="form-label required">Primary Table</label>
                <select
                  value={selectedTableId}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedTableId(value || '');
                    // Remove from additional tables if selected as primary
                    if (value) {
                      setAdditionalTableIds(prev => prev.filter(id => id !== value));
                    }
                  }}
                  className="table-select"
                  required
                >
                  <option value="">Select table...</option>
                  {(enrichedTables.length > 0 ? enrichedTables : tableList).map((table) => {
                    const seatsFilled = table.seatsFilled ?? 0;
                    const waitlistCount = table.waitlistCount ?? 0;
                    const tableNumber = table.table_number ?? (table as any).tableNumber;
                    const stakesText = table.stakes_text ?? (table as any).stakesText;
                    const seatsTotal = (table as any).seatsTotal ?? table.seats_total ?? 9;
                    return (
                      <option key={table.id} value={table.id}>
                        Table {tableNumber} — {stakesText} ({seatsFilled}/{seatsTotal} seats, {waitlistCount} waiting)
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Multi-Table Waitlist Toggle */}
            {(
              <div className="form-section">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isMultiTableMode}
                    onChange={(e) => {
                      setIsMultiTableMode(e.target.checked);
                      if (!e.target.checked) {
                        setAdditionalTableIds([]);
                      }
                    }}
                  />
                  <span>Also add to other table waitlists</span>
                </label>
              </div>
            )}

            {/* Additional Tables Selection */}
            {isMultiTableMode && (
              <div className="form-section" ref={multiTableRef}>
                <label className="form-label">Additional Waitlists</label>
                <div className="multi-table-select">
                  {(enrichedTables.length > 0 ? enrichedTables : tableList)
                    .filter(table => table.id !== selectedTableId)
                    .map((table) => {
                      const seatsFilled = table.seatsFilled ?? 0;
                      const waitlistCount = table.waitlistCount ?? 0;
                      const tableNumber = table.table_number ?? (table as any).tableNumber;
                      const stakesText = table.stakes_text ?? (table as any).stakesText;
                      const seatsTotal = (table as any).seatsTotal ?? table.seats_total ?? 9;
                      const isSelected = additionalTableIds.includes(table.id);
                      return (
                        <label key={table.id} className="multi-table-option">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAdditionalTableIds(prev => [...prev, table.id]);
                              } else {
                                setAdditionalTableIds(prev => prev.filter(id => id !== table.id));
                              }
                            }}
                          />
                          <span className={`multi-table-label ${seatsFilled >= seatsTotal ? 'full' : ''}`}>
                            Table {tableNumber} — {stakesText} ({seatsFilled}/{seatsTotal}, {waitlistCount} waiting)
                          </span>
                        </label>
                      );
                    })}
                </div>
                {additionalTableIds.length > 0 && (
                  <div className="multi-table-summary">
                    Will also waitlist at {additionalTableIds.length} additional table{additionalTableIds.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}

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
              disabled={loading || nick.trim().length < 2 || !selectedTableId || !nick.trim()}
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
