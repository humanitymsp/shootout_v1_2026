/**
 * TableCard Component
 * 
 * 🔒 LOCKED SECTION: Drag and Drop Functionality
 * The drag and drop implementation (handleDragStart, handleDragEnd, handleDrop, handleDragOver,
 * handleDragLeave, and related optimistic update logic in loadTableData) is LOCKED.
 * 
 * These functions work together to:
 * - Prevent players from disappearing during drag operations
 * - Maintain optimistic UI updates until server confirms moves
 * - Handle real-time updates via BroadcastChannel
 * 
 * DO NOT MODIFY drag and drop code without explicit approval.
 * Look for 🔒 LOCKED comments marking protected sections.
 */

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { getSeatedPlayersForTable, getWaitlistForTable, removePlayerFromSeat, addPlayerToWaitlist, removePlayerFromWaitlist, seatNextFromWaitlist, updateTable, deleteTable, seatPlayer, getSeatedPlayersForPlayer, seatCalledInPlayer, getCheckInForPlayer, removePlayerFromAllWaitlists } from '../lib/api';
import { generateClient } from '../lib/graphql-client';
import type { PokerTable, TableSeat, TableWaitlist } from '../types';
import type { SelectedPlayerEntry } from '../pages/AdminPage';
import { showToast } from './Toast';
import { showConfirmDialog } from './ConfirmDialog';
import Tooltip from './Tooltip';
import DoorFeeModal from './DoorFeeModal';
import { log, logWarn, logError } from '../lib/logger';
import { highlightAllMatches } from '../utils/highlightText';
import './TableCard.css';
import '../utils/highlightText.css';

const client = generateClient();

interface TableCardProps {
  table: PokerTable;
  clubDayId: string;
  adminUser: string;
  allTables: PokerTable[];
  onRefresh: () => void;
  selectedPlayers: Record<string, SelectedPlayerEntry>;
  onTogglePlayerSelection: (entry: SelectedPlayerEntry) => void;
  onBreakTable?: (tableId: string) => void;
  onHideTable?: (tableId: string) => void;
  onDuplicateTable?: (table: PokerTable) => void;
  searchQuery?: string;
  isPersistent?: boolean;
}

function TableCard({
  table,
  clubDayId,
  adminUser,
  allTables,
  onRefresh,
  selectedPlayers,
  onTogglePlayerSelection,
  onBreakTable,
  onHideTable,
  onDuplicateTable,
  searchQuery = '',
  isPersistent = false,
}: TableCardProps) {
  const [seatedPlayers, setSeatedPlayers] = useState<TableSeat[]>([]);
  const [waitlistPlayers, setWaitlistPlayers] = useState<TableWaitlist[]>([]);
  const [playerAssignments, setPlayerAssignments] = useState<Map<string, { seated?: number; waitlisted?: number }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bombPotCount, setBombPotCount] = useState(table.bomb_pot_count ?? 1);
  const [lockoutCount, setLockoutCount] = useState(table.lockout_count ?? 0);
  const [showOnTv, setShowOnTv] = useState(table.show_on_tv ?? true);
  const [showOnPublic, setShowOnPublic] = useState(() => {
    try {
      const hidden = JSON.parse(localStorage.getItem('hidden-from-public') || '[]');
      return !hidden.includes(table.id);
    } catch { return true; }
  });
  const [buyInLimits, setBuyInLimits] = useState(table.buy_in_limits || '');
  const [isEditingBuyIn, setIsEditingBuyIn] = useState(false);
  const [stakesText, setStakesText] = useState(table.stakes_text || '');
  const [isEditingStakes, setIsEditingStakes] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isEditingTableNumber, setIsEditingTableNumber] = useState(false);
  const [editTableNumber, setEditTableNumber] = useState(table.table_number.toString());
  const [draggedPlayer, setDraggedPlayer] = useState<(TableWaitlist | TableSeat) & { _sourceTableId?: string; _isFromWaitlist?: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; player: TableSeat | TableWaitlist; isFromWaitlist: boolean } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<'seated' | 'waitlist' | null>(null);
  const [tableChangeMenu, setTableChangeMenu] = useState<{ player: TableSeat | TableWaitlist; isFromWaitlist: boolean } | null>(null);
  const [tcAddAll, setTcAddAll] = useState(false);
  const [tcSameGameOnly, setTcSameGameOnly] = useState(true);
  const [doorFeeModal, setDoorFeeModal] = useState<{ player: TableWaitlist; playerName: string; defaultAmount: number } | null>(null);
  const [wlGameTypeMenu, setWlGameTypeMenu] = useState<{ player: TableSeat | TableWaitlist } | null>(null);
  const [checkinCache, setCheckinCache] = useState<Map<string, { amount: number; isPrevious: boolean }>>(new Map());
  const inFlightMovesRef = useRef<Set<string>>(new Set());
  const lastRefreshRef = useRef<number>(0);
  const refreshCooldownRef = useRef<number>(2000); // 2s cooldown between refreshes (prevents cascade from multi-event triggers)
  const optimisticUpdatesRef = useRef<Set<string>>(new Set()); // Track players with optimistic updates
  const optimisticPlayersRef = useRef<{ seated: TableSeat[]; waitlist: TableWaitlist[] }>({ seated: [], waitlist: [] }); // Store optimistic players
  
  // localStorage keys for persisting optimistic players across refreshes
  const OPTIMISTIC_SEATED_KEY = `optimistic-seated-${table.id}`;
  const OPTIMISTIC_WAITLIST_KEY = `optimistic-waitlist-${table.id}`;
  const OPTIMISTIC_TIMESTAMP_KEY = `optimistic-timestamp-${table.id}`;
  const OPTIMISTIC_MAX_AGE = 5 * 60 * 1000; // 5 minutes - optimistic players should be confirmed by then
  
  // Helper functions to persist/restore optimistic players
  const saveOptimisticPlayers = () => {
    try {
      const timestamp = Date.now();
      localStorage.setItem(OPTIMISTIC_SEATED_KEY, JSON.stringify(optimisticPlayersRef.current.seated));
      localStorage.setItem(OPTIMISTIC_WAITLIST_KEY, JSON.stringify(optimisticPlayersRef.current.waitlist));
      localStorage.setItem(OPTIMISTIC_TIMESTAMP_KEY, timestamp.toString());
    } catch (error) {
      logWarn('Failed to save optimistic players to localStorage:', error);
    }
  };
  
  const loadOptimisticPlayers = (): { seated: TableSeat[]; waitlist: TableWaitlist[] } => {
    try {
      const timestamp = localStorage.getItem(OPTIMISTIC_TIMESTAMP_KEY);
      if (!timestamp) return { seated: [], waitlist: [] };
      
      const age = Date.now() - parseInt(timestamp, 10);
      if (age > OPTIMISTIC_MAX_AGE) {
        // Stale optimistic data, clear it
        clearOptimisticPlayers();
        return { seated: [], waitlist: [] };
      }
      
      const seatedStr = localStorage.getItem(OPTIMISTIC_SEATED_KEY);
      const waitlistStr = localStorage.getItem(OPTIMISTIC_WAITLIST_KEY);
      
      const seated = seatedStr ? JSON.parse(seatedStr) : [];
      const waitlist = waitlistStr ? JSON.parse(waitlistStr) : [];
      
      // Restore optimistic tracking set
      seated.forEach((seat: TableSeat) => optimisticUpdatesRef.current.add(seat.player_id));
      waitlist.forEach((wl: TableWaitlist) => optimisticUpdatesRef.current.add(wl.player_id));
      
      return { seated, waitlist };
    } catch (error) {
      logWarn('Failed to load optimistic players from localStorage:', error);
      return { seated: [], waitlist: [] };
    }
  };
  
  const clearOptimisticPlayers = () => {
    try {
      localStorage.removeItem(OPTIMISTIC_SEATED_KEY);
      localStorage.removeItem(OPTIMISTIC_WAITLIST_KEY);
      localStorage.removeItem(OPTIMISTIC_TIMESTAMP_KEY);
    } catch (error) {
      logWarn('Failed to clear optimistic players from localStorage:', error);
    }
  };
  
  const stakesLabel = (stakesText || table.stakes_text).replace(/No Limit/gi, 'NL');
  const activeWaitlistPlayers = waitlistPlayers
    .filter((wl) => !wl.called_in)
    .sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());

  // Load check-in data for waitlist players to show buy-in amounts
  useEffect(() => {
    const loadCheckins = async () => {
      const newCache = new Map<string, { amount: number; isPrevious: boolean }>();
      for (const wl of activeWaitlistPlayers) {
        if (checkinCache.has(wl.player_id)) {
          newCache.set(wl.player_id, checkinCache.get(wl.player_id)!);
          continue;
        }
        try {
          const checkIn = await getCheckInForPlayer(wl.player_id, clubDayId);
          if (checkIn) {
            newCache.set(wl.player_id, {
              amount: checkIn.door_fee_amount,
              isPrevious: checkIn.door_fee_amount === 0,
            });
          }
        } catch { /* skip */ }
      }
      if (newCache.size > 0) setCheckinCache(newCache);
    };
    if (activeWaitlistPlayers.length > 0) loadCheckins();
  }, [waitlistPlayers.length, clubDayId]);
  
  useEffect(() => {
    // Restore optimistic players from localStorage on mount (survives page refresh)
    const restored = loadOptimisticPlayers();
    if (restored.seated.length > 0 || restored.waitlist.length > 0) {
      log('📦 Restored optimistic players from localStorage:', {
        seated: restored.seated.length,
        waitlist: restored.waitlist.length
      });
      optimisticPlayersRef.current = restored;
      // Set state immediately so players appear right away
      setSeatedPlayers(restored.seated);
      setWaitlistPlayers(restored.waitlist);
    }
    
    loadTableData();
  }, [table.id]); // Only reload when table.id changes, not on every render

  // Auto-refresh persistent tables every 15 seconds
  useEffect(() => {
    if (!isPersistent && !table.is_persistent) return;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      setRefreshing(true);
      await loadTableData(true);
      setRefreshing(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [table.id, isPersistent, table.is_persistent]);

  useEffect(() => {
    setBombPotCount(table.bomb_pot_count ?? 1);
  }, [table.bomb_pot_count]);

  useEffect(() => {
    setLockoutCount(table.lockout_count ?? 0);
  }, [table.lockout_count]);

  useEffect(() => {
    setShowOnTv(table.show_on_tv ?? true);
  }, [table.show_on_tv]);

  useEffect(() => {
    setBuyInLimits(table.buy_in_limits || '');
  }, [table.buy_in_limits]);

  useEffect(() => {
    setStakesText(table.stakes_text || '');
  }, [table.stakes_text]);

  // ============================================================================
  // 🔒 LOCKED: Real-time Update Handlers (Broadcast/Storage)
  // ============================================================================
  // These handlers manage real-time updates for drag and drop operations.
  // They ensure source tables remove players immediately while destination
  // tables preserve optimistic players. DO NOT MODIFY WITHOUT APPROVAL
  // ============================================================================
  
  // Listen for real-time player updates
  useEffect(() => {
    const handleBroadcastMessage = (event: MessageEvent) => {
      if (event.data?.type === 'player-update') {
        log('📡 TableCard: Received player update broadcast:', event.data, 'for table:', table.id);
        const updateData = event.data;
        const playerId = updateData.playerId;
        const action = updateData.action;
        const fromTableId = updateData.fromTableId;
        
        // CRITICAL: Handle immediate removal requests (from drag start)
        // IMPORTANT: Only remove if we're certain this is a valid removal (has destination table)
        if (action === 'remove-immediate' && fromTableId === table.id && playerId && updateData.toTableId) {
          log('📡 Broadcast received - immediate removal request, removing player:', playerId, 'to table:', updateData.toTableId);
          // Track as in-flight to prevent re-adding during refresh
          inFlightMovesRef.current.add(playerId);
          optimisticUpdatesRef.current.add(playerId);
          // Remove from local state optimistically (will be confirmed by server refresh)
          setSeatedPlayers(prev => {
            const filtered = prev.filter(s => s.player_id !== playerId);
            if (filtered.length !== prev.length) {
              log('✅ Removed player from seated list (immediate removal)');
            }
            return filtered;
          });
          setWaitlistPlayers(prev => {
            const filtered = prev.filter(w => w.player_id !== playerId);
            if (filtered.length !== prev.length) {
              log('✅ Removed player from waitlist (immediate removal)');
            }
            return filtered;
          });
          // Clear optimistic players from ref
          optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
          optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
          saveOptimisticPlayers(); // Update localStorage
          // Refresh after short delay to confirm removal with server
          setTimeout(() => loadTableData(true), 500);
          return; // Don't refresh yet, wait for actual move completion
        }
        
        // CRITICAL: Handle player moved FROM this table
        // IMPORTANT: Only remove if we're certain the move succeeded (has toTableId)
        // Don't remove if move might have failed or if this is the destination table
        if (action === 'move' && fromTableId === table.id && updateData.toTableId && updateData.toTableId !== table.id && playerId) {
          log('📡 Broadcast received - player moved FROM this table to', updateData.toTableId, '- removing:', playerId);
          // Track as in-flight to prevent re-adding during refresh
          inFlightMovesRef.current.add(playerId);
          // Remove from local state optimistically (will be confirmed by server refresh)
          setSeatedPlayers(prev => {
            const filtered = prev.filter(s => s.player_id !== playerId);
            if (filtered.length !== prev.length) {
              log('✅ Removed player from seated list optimistically');
            }
            return filtered;
          });
          setWaitlistPlayers(prev => {
            const filtered = prev.filter(w => w.player_id !== playerId);
            if (filtered.length !== prev.length) {
              log('✅ Removed player from waitlist optimistically');
            }
            return filtered;
          });
          // Clear optimistic players from ref
          optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
          optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
          saveOptimisticPlayers(); // Update localStorage
          // Refresh after short delay to confirm removal with server
          setTimeout(() => loadTableData(true), 500);
        }
        
        // Handle seat-called-in, seat-next, and checkin actions with immediate optimistic update
        if ((updateData.action === 'seat-called-in' || updateData.action === 'seat-next' || updateData.action === 'checkin') && 
            (updateData.tableId === table.id || !updateData.tableId) && 
            updateData.playerId) {
          log('📡 TableCard: Received seat/checkin action, adding player optimistically:', updateData.playerId);

          const isCheckinWaitlist = updateData.action === 'checkin' && updateData.assignmentMode === 'waitlist';
          const isCheckinSeat = updateData.action === 'checkin' &&
            (!updateData.assignmentMode || updateData.assignmentMode === 'seat');
          const isSeatAction = updateData.action === 'seat-called-in' || updateData.action === 'seat-next' || isCheckinSeat;
          
          if (isCheckinWaitlist) {
            setWaitlistPlayers(prev => {
              const alreadyWaitlisted = prev.some(w => w.player_id === updateData.playerId);
              if (alreadyWaitlisted) {
                log('✅ Player already in waitlist, skipping optimistic add');
                return prev;
              }

              // Use player_id + timestamp + random to ensure unique ID
              const uniqueId = `temp-waitlist-${updateData.playerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const optimisticWaitlist: TableWaitlist = {
                id: uniqueId,
                club_day_id: clubDayId,
                table_id: table.id,
                player_id: updateData.playerId,
                player: updateData.playerData || undefined,
                position: prev.length + 1,
                added_at: new Date().toISOString(),
                removed_at: undefined,
                called_in: false,
                created_at: new Date().toISOString(),
              };

              optimisticPlayersRef.current.waitlist.push(optimisticWaitlist);
              optimisticUpdatesRef.current.add(updateData.playerId);
              saveOptimisticPlayers(); // Persist to localStorage

              log('✅ Optimistically added player to waitlist - player appears immediately:', optimisticWaitlist);
              return [...prev, optimisticWaitlist];
            });
          }

          if (isSeatAction) {
            // IMMEDIATELY remove from waitlist if they were there (optimistic update)
            setWaitlistPlayers(prev => {
              const filtered = prev.filter(w => w.player_id !== updateData.playerId);
              if (filtered.length !== prev.length) {
                log('✅ Removed player from waitlist optimistically');
              }
              return filtered;
            });
            
            // IMMEDIATELY add player to seated list (optimistic update)
            setSeatedPlayers(prev => {
              const alreadySeated = prev.some(s => s.player_id === updateData.playerId);
              if (alreadySeated) {
                log('✅ Player already in seated list, skipping optimistic add');
                return prev;
              }
              
              // Create optimistic seat entry with player data from broadcast
              // Use player_id + timestamp + random to ensure unique ID
              const uniqueId = `temp-seat-${updateData.playerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const optimisticSeat: TableSeat = {
                id: uniqueId,
                club_day_id: clubDayId,
                table_id: table.id,
                player_id: updateData.playerId,
                player: updateData.playerData || undefined, // Use player data from broadcast if available
                seated_at: new Date().toISOString(),
                left_at: undefined,
                created_at: new Date().toISOString(),
              };
              
              // Add to optimistic players ref so it persists across refreshes
              optimisticPlayersRef.current.seated.push(optimisticSeat);
              optimisticUpdatesRef.current.add(updateData.playerId);
              saveOptimisticPlayers(); // Persist to localStorage
              
              log('✅ Optimistically added player to seated - player appears immediately:', optimisticSeat);
              return [...prev, optimisticSeat];
            });
          }
          
          // Don't refresh immediately - optimistic update is already visible
          // Refresh will happen after server confirms (via API call completion)
          // This prevents clearing the optimistic update before server processes
          return; // Early return, don't process other refresh logic
        }
        
        // Refresh if:
        // 1. It's a move that affects this table (source or destination)
        // 2. It's a checkin that might affect this table (if tableId matches or not specified)
        // 3. It's a refresh-table action for this table
        // 4. Any player update (to be safe)
        const shouldRefresh = 
          updateData.action === 'refresh-table' && updateData.tableId === table.id ||
          updateData.action === 'move' && 
          (updateData.fromTableId === table.id || updateData.toTableId === table.id) ||
          updateData.action === 'checkin' && 
          (updateData.tableId === table.id || !updateData.tableId) ||
          updateData.action === 'remove' ||
          !updateData.action; // Legacy updates without action
        
        if (shouldRefresh) {
          log('🔄 TableCard: Refreshing table data due to broadcast update');
          // Use a small delay to avoid race conditions with direct API calls
          setTimeout(() => loadTableData(), 300);
        }
      }
    };

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === 'player-updated') {
        log('📡 TableCard: Received player update via storage, refreshing table:', table.id);
        // Use a small delay to avoid race conditions
        setTimeout(() => loadTableData(), 300);
      } else if (event.key === 'player-update-data') {
        try {
          const updateData = JSON.parse(event.newValue || '{}');
          if (updateData.type === 'player-update') {
            const playerId = updateData.playerId;
            const fromTableId = updateData.fromTableId;
            const action = updateData.action;
            
            // CRITICAL: Handle immediate removal requests (from drag start)
            if (action === 'remove-immediate' && fromTableId === table.id && playerId) {
              log('💾 Storage event - immediate removal request, removing player:', playerId);
              // Immediately remove from local state to prevent ghosting
              setSeatedPlayers(prev => prev.filter(s => s.player_id !== playerId));
              setWaitlistPlayers(prev => prev.filter(w => w.player_id !== playerId));
              // Clear optimistic players from ref if this is source table
              optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
              optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
              saveOptimisticPlayers(); // Update localStorage
              // Track as in-flight to prevent re-adding during refresh
              inFlightMovesRef.current.add(playerId);
              optimisticUpdatesRef.current.add(playerId);
              return; // Don't refresh yet, wait for actual move completion
            }
            
            // CRITICAL: Immediately filter out moved player from source table BEFORE refresh
            // BUT: Don't remove if this is the destination table (player is being added here)
            if (action === 'move' && fromTableId === table.id && updateData.toTableId !== table.id && playerId) {
              log('💾 Storage event - player moved FROM this table, immediately removing:', playerId);
              // Immediately remove from local state to prevent ghosting
              setSeatedPlayers(prev => prev.filter(s => s.player_id !== playerId));
              setWaitlistPlayers(prev => prev.filter(w => w.player_id !== playerId));
              // Clear optimistic players from ref if this is source table
              optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
              optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
              saveOptimisticPlayers(); // Update localStorage
              // Track as in-flight to prevent re-adding during refresh
              inFlightMovesRef.current.add(playerId);
            }
            
            // Refresh if move affects this table
            if (fromTableId === table.id || updateData.toTableId === table.id) {
              setTimeout(() => loadTableData(), 300);
            }
          }
        } catch (error) {
          logWarn('Error parsing player-update-data:', error);
        }
      }
    };

    // Listen for broadcast messages
    let broadcastChannel: BroadcastChannel | null = null;
    try {
      broadcastChannel = new BroadcastChannel('admin-updates');
      broadcastChannel.addEventListener('message', handleBroadcastMessage);
    } catch (error) {
      logWarn('TableCard: BroadcastChannel not available:', error);
    }

    // Listen for same-tab player-update CustomEvents (from CheckInModal etc.)
    // BroadcastChannel only reaches OTHER tabs, so this handles the same-tab case
    const handleCustomPlayerUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) {
        handleBroadcastMessage({ data: detail } as MessageEvent);
      }
    };
    window.addEventListener('player-update', handleCustomPlayerUpdate);

    // Listen for storage events (cross-tab)
    window.addEventListener('storage', handleStorageEvent);

    // Track last processed update to avoid duplicate refreshes
    let lastProcessedUpdate: string | null = null;

    // Poll localStorage for changes (since same-tab changes don't trigger storage events)
    const pollInterval = setInterval(() => {
      if (document.hidden) return;
      const lastUpdate = localStorage.getItem('player-updated');
      if (lastUpdate && lastUpdate !== lastProcessedUpdate) {
        const lastUpdateTime = new Date(lastUpdate).getTime();
        const now = Date.now();
        // Only refresh if update was within last 5 seconds and we haven't processed it
        if (now - lastUpdateTime < 5000) {
          lastProcessedUpdate = lastUpdate;
          setTimeout(() => loadTableData(), 200);
        }
      }
    }, 10000);

    return () => {
      if (broadcastChannel) {
        broadcastChannel.removeEventListener('message', handleBroadcastMessage);
        broadcastChannel.close();
      }
      window.removeEventListener('player-update', handleCustomPlayerUpdate);
      window.removeEventListener('storage', handleStorageEvent);
      clearInterval(pollInterval);
    };
  }, [table.id]);

  // ============================================================================
  // 🔒 LOCKED: loadTableData - Optimistic Player Preservation Logic
  // ============================================================================
  // This function is critical for drag and drop functionality. It preserves
  // optimistic players (those with temp IDs) until the server confirms their
  // new location, preventing players from disappearing during moves.
  // DO NOT MODIFY THE OPTIMISTIC PLAYER PRESERVATION LOGIC WITHOUT APPROVAL
  // ============================================================================
  const loadTableData = async (skipCooldown = false) => {
    const now = Date.now();
    
    // Skip if we've refreshed too recently (unless explicitly requested)
    if (!skipCooldown && now - lastRefreshRef.current < refreshCooldownRef.current) {
      log('⏭️ Skipping refresh - too soon after last refresh');
      return;
    }
    
    lastRefreshRef.current = now;
    log('🔄 Loading table data for table:', table.id);
    
    // CRITICAL: Pass clubDayId to prevent showing players from old club days after reset
    // This ensures tables are empty when a new club day starts
    const [seated, waitlist] = await Promise.all([
      getSeatedPlayersForTable(table.id, clubDayId),
      getWaitlistForTable(table.id, clubDayId),
    ]);
    
    // Filter out any temporary optimistic entries from server response
    const filteredSeated = seated.filter(seat => !seat.id.startsWith('temp-'));
    const filteredWaitlist = waitlist.filter(wl => !wl.id.startsWith('temp-'));
    
    // CRITICAL: Keep optimistic players visible until server confirms their new location
    // Build sets of player IDs from server response (source of truth)
    const serverSeatedPlayerIds = new Set(filteredSeated.map(s => s.player_id));
    const serverWaitlistPlayerIds = new Set(filteredWaitlist.map(w => w.player_id));
    
    // Get optimistic players from ref (persists across renders and state updates)
    const currentOptimisticSeated = optimisticPlayersRef.current.seated;
    const currentOptimisticWaitlist = optimisticPlayersRef.current.waitlist;
    
    log('📊 loadTableData - Optimistic seated players in ref:', currentOptimisticSeated.length, 'Tracked:', optimisticUpdatesRef.current.size);
    
    // Build final lists: server data + optimistic players that aren't yet confirmed by server
    // CRITICAL: Deduplicate by player_id to prevent duplicates
    const finalSeatedMap = new Map<string, TableSeat>();
    
    // First, add all server data (source of truth)
    filteredSeated.forEach(seat => {
      finalSeatedMap.set(seat.player_id, seat);
    });
    
    // CRITICAL: Add optimistic players that aren't yet in server response
    // IMPORTANT: Keep optimistic players even if tracking is lost - they might still be processing on server
    // Only remove when server explicitly confirms they're at this table
    currentOptimisticSeated.forEach(opt => {
      const playerId = opt.player_id;
      const serverHasPlayer = serverSeatedPlayerIds.has(playerId);
      
      // CRITICAL: If server shows the player, replace optimistic entry with server data
      if (serverHasPlayer) {
        log('✅ Server now confirms optimistic player, removing temp entry:', playerId);
        optimisticUpdatesRef.current.delete(playerId);
        // Remove from ref (server data is already in finalSeatedMap)
        optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
        saveOptimisticPlayers(); // Update localStorage
      } else {
        // Server doesn't show them yet - keep optimistic entry
        // CRITICAL: Keep even if tracking is lost - operation might still be processing
        if (!finalSeatedMap.has(playerId)) {
          const hasTracking = optimisticUpdatesRef.current.has(playerId);
          if (hasTracking) {
            log('✅ Keeping optimistic seated player until server confirms:', playerId);
          } else {
            logWarn('⚠️ Keeping optimistic player without tracking (may still be processing):', playerId);
          }
          finalSeatedMap.set(playerId, opt);
        }
      }
    });
    
    const finalSeated = Array.from(finalSeatedMap.values());
    
    // CRITICAL: Deduplicate waitlist by player_id to prevent duplicates
    const finalWaitlistMap = new Map<string, TableWaitlist>();
    
    // First, add all server data (source of truth)
    filteredWaitlist.forEach(wl => {
      finalWaitlistMap.set(wl.player_id, wl);
    });
    
    // CRITICAL: Add optimistic waitlist players that aren't yet in server response
    // IMPORTANT: Keep optimistic players even if tracking is lost - they might still be processing on server
    // Only remove when server explicitly confirms they're at this table
    currentOptimisticWaitlist.forEach(opt => {
      const playerId = opt.player_id;
      const serverHasPlayer = serverWaitlistPlayerIds.has(playerId);
      
      // CRITICAL: If server shows the player, replace optimistic entry with server data
      if (serverHasPlayer) {
        log('✅ Server now confirms optimistic waitlist player, removing temp entry:', playerId);
        optimisticUpdatesRef.current.delete(playerId);
        // Remove from ref (server data is already in finalWaitlistMap)
        optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
        saveOptimisticPlayers(); // Update localStorage
      } else {
        // Server doesn't show them yet - keep optimistic entry
        // CRITICAL: Keep even if tracking is lost - operation might still be processing
        if (!finalWaitlistMap.has(playerId)) {
          const hasTracking = optimisticUpdatesRef.current.has(playerId);
          if (hasTracking) {
            log('✅ Keeping optimistic waitlist player until server confirms:', playerId);
          } else {
            logWarn('⚠️ Keeping optimistic waitlist player without tracking (may still be processing):', playerId);
          }
          finalWaitlistMap.set(playerId, opt);
        }
      }
    });
    
    const finalWaitlist = Array.from(finalWaitlistMap.values());
    
    // Clear optimistic updates and ref entries for players that server confirms are at this table
    filteredSeated.forEach(seat => {
      const playerId = seat.player_id;
      if (optimisticUpdatesRef.current.has(playerId)) {
        log('✅ Server confirms player is here, clearing optimistic update:', playerId);
        optimisticUpdatesRef.current.delete(playerId);
        // Remove from optimistic ref
        optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
        saveOptimisticPlayers(); // Update localStorage
      }
    });
    filteredWaitlist.forEach(wl => {
      const playerId = wl.player_id;
      if (optimisticUpdatesRef.current.has(playerId)) {
        log('✅ Server confirms player is here, clearing optimistic update:', playerId);
        optimisticUpdatesRef.current.delete(playerId);
        optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
        saveOptimisticPlayers(); // Update localStorage
      }
    });
    
    // CRITICAL: Log player count changes to track disappearing players
    const previousSeatedCount = seatedPlayers.length;
    
    log('📊 Loaded data - Seated:', finalSeated.length, 'Waitlist:', finalWaitlist.length, 'In-flight moves:', inFlightMovesRef.current.size);
    log(`📊 Table ${table.table_number} - Server seats: ${filteredSeated.length}, Optimistic: ${currentOptimisticSeated.length}, Final: ${finalSeated.length}`);
    
    // CRITICAL: Warn if players disappeared
    if (finalSeated.length < previousSeatedCount) {
      const disappeared = previousSeatedCount - finalSeated.length;
      const previousPlayerIds = new Set(seatedPlayers.map(s => s.player_id));
      const currentPlayerIds = new Set(finalSeated.map(s => s.player_id));
      const missingPlayers = Array.from(previousPlayerIds).filter(id => !currentPlayerIds.has(id));
      logWarn(`⚠️ WARNING: ${disappeared} player(s) disappeared from table ${table.table_number}:`, missingPlayers);
      logWarn(`   Previous count: ${previousSeatedCount}, Current count: ${finalSeated.length}`);
      logWarn(`   Server seats: ${filteredSeated.length}, Optimistic: ${currentOptimisticSeated.length}`);
    }
    
    // Always update state with server data to prevent ghosting
    // The server is the source of truth
    setSeatedPlayers(finalSeated);
    setWaitlistPlayers(finalWaitlist);
    
    // Note: Display count is now computed directly from displayedSeatedPlayers (filtered/deduplicated)
    // This ensures counts match TV/Tablet/Public views exactly
    
    // Don't clear all optimistic updates here - only clear ones that server confirms are resolved
    // The filtering logic above already clears stale optimistic updates for players server shows
    // Keep in-flight moves tracking until moves complete
    
    // Pass the loaded data directly to avoid race condition with state updates
    loadPlayerAssignments(finalSeated, finalWaitlist);
  };

  const loadPlayerAssignments = async (seated: TableSeat[], waitlist: TableWaitlist[]) => {
    // Load all players to check their other assignments
    const assignments = new Map<string, { seated?: number; waitlisted?: number }>();
    
    // Check seated players for waitlist assignments
    for (const seat of seated) {
      const { data: wlData } = await client.models.TableWaitlist.list({
        filter: {
          and: [
            { playerId: { eq: seat.player_id } },
            { clubDayId: { eq: clubDayId } },
            { removedAt: { attributeExists: false } },
          ],
        },
      });
      if (wlData && wlData.length > 0) {
        const wlTable = await client.models.PokerTable.get({ id: wlData[0].tableId });
        assignments.set(seat.player_id, { waitlisted: wlTable.data?.tableNumber });
      }
    }

    // Check waitlist players for seat assignments
    for (const wl of waitlist) {
      const { data: seatData } = await client.models.TableSeat.list({
        filter: {
          and: [
            { playerId: { eq: wl.player_id } },
            { clubDayId: { eq: clubDayId } },
            { leftAt: { attributeExists: false } },
          ],
        },
      });
      if (seatData && seatData.length > 0) {
        const seatTable = await client.models.PokerTable.get({ id: seatData[0].tableId });
        assignments.set(wl.player_id, { seated: seatTable.data?.tableNumber });
      }
    }

    setPlayerAssignments(assignments);
  };

  const handleSeatNext = async () => {
    if (activeWaitlistPlayers.length === 0) {
      showToast('Waitlist is empty', 'info');
      return;
    }
    
    // Use real count (excluding optimistic) to match display
    const realSeatedCount = seatedPlayers.filter(s => !s.id.startsWith('temp-')).length;
    if (realSeatedCount >= table.seats_total) {
      showToast(`Table is full (${realSeatedCount}/${table.seats_total} seats)`, 'error');
      return;
    }
    
    const firstWaitlistPlayer = activeWaitlistPlayers[0];
    const playerId = firstWaitlistPlayer.player_id;
    
    if (inFlightMovesRef.current.has(playerId)) {
      logWarn('Move already in flight for player:', playerId);
      return;
    }
    inFlightMovesRef.current.add(playerId);
    
    // Player must have bought in (CheckIn record) before they can be seated
    {
      const playerName = firstWaitlistPlayer.player?.nick || 'Unknown';
      let defaultAmount = 20;
      let checkIn = null;
      try {
        checkIn = await getCheckInForPlayer(firstWaitlistPlayer.player_id, clubDayId);
        if (checkIn?.door_fee_amount) defaultAmount = checkIn.door_fee_amount;
      } catch { /* use default */ }
      if (!checkIn) {
        showToast(`${playerName} must buy in before being seated`, 'error');
        inFlightMovesRef.current.delete(playerId);
        return;
      }
      // Previous player ($0 check-in): auto-seat without DoorFeeModal
      if (checkIn.door_fee_amount === 0) {
        autoSeatPreviousPlayer(firstWaitlistPlayer, table.id);
        inFlightMovesRef.current.delete(playerId);
        return;
      }
      setDoorFeeModal({ player: firstWaitlistPlayer, playerName, defaultAmount });
      inFlightMovesRef.current.delete(playerId);
      return;
    }
  };

  const autoSeatPreviousPlayer = async (wlPlayer: TableWaitlist, targetTableId: string) => {
    const playerId = wlPlayer.player_id;
    const playerData = wlPlayer.player;

    // Step 1: Remove from waitlist optimistically
    setWaitlistPlayers(prev => prev.filter(w => w.id !== wlPlayer.id && w.player_id !== playerId));

    // Step 2: Create optimistic seat entry
    const uniqueId = `temp-seat-${playerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const optimisticSeat: TableSeat = {
      id: uniqueId,
      club_day_id: clubDayId,
      table_id: targetTableId,
      player_id: playerId,
      player: playerData,
      seated_at: new Date().toISOString(),
      left_at: undefined,
      created_at: new Date().toISOString(),
    };

    optimisticPlayersRef.current.seated.push(optimisticSeat);
    optimisticUpdatesRef.current.add(playerId);

    if (targetTableId === table.id) {
      setSeatedPlayers(prev => {
        if (prev.some(s => s.player_id === playerId)) return prev;
        return [...prev, optimisticSeat];
      });
    }

    // Check TC status
    let wasTC = false;
    try {
      const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
      wasTC = tcList.some((entry: any) => entry.playerId === playerId);
      const cleaned = tcList.filter((entry: any) => entry.playerId !== playerId);
      localStorage.setItem('tc-list', JSON.stringify(cleaned));
    } catch {}

    // Broadcast
    try {
      const channel = new BroadcastChannel('admin-updates');
      channel.postMessage({
        type: 'player-update',
        action: 'seat-next',
        tableId: targetTableId,
        playerId,
        playerData,
      });
      channel.close();
    } catch {}

    // Seat via API (previous player: just seat, no accounting)
    if (!inFlightMovesRef.current.has(playerId)) {
      inFlightMovesRef.current.add(playerId);
    }
    seatPlayer(targetTableId, playerId, clubDayId)
      .then(async () => {
        log('✅ Previous player seated successfully');
        // Note: Player remains on other game type waitlists (multi-game-type support)
        // If TC player, also remove from previous table's seat
        if (wasTC) {
          try {
            const allSeats = await getSeatedPlayersForPlayer(playerId, clubDayId);
            const oldSeats = allSeats.filter(s => s.table_id !== targetTableId);
            for (const oldSeat of oldSeats) {
              await removePlayerFromSeat(oldSeat.id, oldSeat.table_id, adminUser);
              log(`Removed TC previous player from old seat at table ${oldSeat.table_id}`);
            }
          } catch (err) {
            logWarn('Failed to remove TC player from previous table:', err);
          }
        }
        localStorage.setItem('player-updated', new Date().toISOString());
        setTimeout(() => {
          loadTableData(true);
          inFlightMovesRef.current.delete(playerId);
          onRefresh();
        }, 300);
      })
      .catch((err: any) => {
        logError('❌ Failed to seat previous player:', err);
        if (targetTableId === table.id) {
          setSeatedPlayers(prev => prev.filter(s => s.id !== optimisticSeat.id && s.player_id !== playerId));
        }
        optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
        optimisticUpdatesRef.current.delete(playerId);
        inFlightMovesRef.current.delete(playerId);
        saveOptimisticPlayers();
        showToast(err.message || 'Failed to seat previous player', 'error');
        setTimeout(() => onRefresh(), 300);
      });
  };

  const handleQuickSeat = async () => {
    if (activeWaitlistPlayers.length === 0) {
      showToast('Waitlist is empty', 'info');
      return;
    }

    const realSeatedCount = seatedPlayers.filter(s => !s.id.startsWith('temp-')).length;
    const availableSeats = Math.max(0, table.seats_total - realSeatedCount);
    if (availableSeats === 0) {
      showToast(`Table is full (${realSeatedCount}/${table.seats_total} seats)`, 'error');
      return;
    }

    setLoading(true);
    let seatedCount = 0;
    let skippedCount = 0;

    for (const wl of activeWaitlistPlayers) {
      if (seatedCount >= availableSeats) break;

      const playerName = wl.player?.nick || 'Unknown';
      let checkIn = null;
      try {
        checkIn = await getCheckInForPlayer(wl.player_id, clubDayId);
      } catch { /* skip */ }

      if (!checkIn) {
        skippedCount++;
        continue;
      }

      try {
        await seatPlayer(table.id, wl.player_id, clubDayId);
        seatedCount++;
        // Check if TC player and remove from previous table
        try {
          const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
          const tcEntry = tcList.find((entry: any) => entry.playerId === wl.player_id);
          if (tcEntry) {
            const allSeats = await getSeatedPlayersForPlayer(wl.player_id, clubDayId);
            const oldSeats = allSeats.filter(s => s.table_id !== table.id);
            for (const oldSeat of oldSeats) {
              await removePlayerFromSeat(oldSeat.id, oldSeat.table_id, adminUser);
              log(`QuickSeat: removed TC player from old seat at table ${oldSeat.table_id}`);
            }
            const cleaned = tcList.filter((entry: any) => entry.playerId !== wl.player_id);
            localStorage.setItem('tc-list', JSON.stringify(cleaned));
          }
        } catch {}
        // Note: Player remains on other game type waitlists (multi-game-type support)
      } catch (err: any) {
        logError(`Failed to seat ${playerName}:`, err);
      }
    }

    if (seatedCount > 0) {
      // Toast removed per user request
      await loadTableData(true);
      onRefresh();
    } else if (skippedCount > 0) {
      showToast(`No players seated — ${skippedCount} player${skippedCount !== 1 ? 's' : ''} haven't bought in yet`, 'warning');
    } else {
      showToast('No players could be seated', 'info');
    }

    setLoading(false);
  };


  const handleBustOut = async (seatId: string) => {
    let seat = seatedPlayers.find(s => s.id === seatId);

    // If this is a temp/optimistic seat, fetch real seats from API to get the actual DB seat ID
    if (seatId.startsWith('temp-') && seat?.player_id) {
      log('Bust out on temp seat, fetching real seat from API for player:', seat.player_id);
      try {
        const realSeats = await getSeatedPlayersForTable(table.id, clubDayId);
        const realSeat = realSeats.find(s => s.player_id === seat!.player_id);
        if (realSeat) {
          seat = realSeat;
          seatId = realSeat.id;
          log('Resolved temp seat to real seat:', seatId);
        } else {
          showToast('Player seat not found — try refreshing first', 'error');
          return;
        }
      } catch (err) {
        logError('Failed to resolve temp seat:', err);
        showToast('Could not verify seat — try refreshing first', 'error');
        return;
      }
    }

    const confirmed = await showConfirmDialog({
      title: 'Bust Out Player',
      message: `Bust out ${seat?.player?.nick || 'this player'}?`,
      confirmText: 'Bust Out',
      cancelText: 'Cancel',
      type: 'warning',
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      log('Busting out player:', { seatId, tableId: table.id, adminUser });
      const seat = seatedPlayers.find(s => s.id === seatId);
      await removePlayerFromSeat(seatId, table.id, adminUser);
      
      // Note: Busted out players remain on other game type waitlists (multi-game-type support)
      // If TC player, also remove from previous table's seat
      try {
        const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
        const tcEntry = tcList.find((entry: any) => entry.playerId === seat?.player_id);
        if (tcEntry) {
          const allSeats = await getSeatedPlayersForPlayer(seat?.player_id, clubDayId);
          const oldSeats = allSeats.filter(s => s.table_id !== table.id);
          for (const oldSeat of oldSeats) {
            await removePlayerFromSeat(oldSeat.id, oldSeat.table_id, adminUser);
            log(`Removed TC player from old seat at table ${oldSeat.table_id}`);
          }
          const cleaned = tcList.filter((entry: any) => entry.playerId !== seat?.player_id);
          localStorage.setItem('tc-list', JSON.stringify(cleaned));
        }
      } catch (err) {
        logWarn('Failed to remove TC player from previous table:', err);
      }
      
      // Broadcast update
      try {
        const channel = new BroadcastChannel('admin-updates');
        const updateData = {
          type: 'player-update',
          action: 'remove',
          tableId: table.id,
          playerId: seat?.player_id,
          waitlistId: null // Bust out doesn't have a waitlist ID
        };
        channel.postMessage(updateData);
        channel.close();
        localStorage.setItem('player-update-data', JSON.stringify(updateData));
      } catch (error) {
        logWarn('Failed to broadcast remove update:', error);
      }
      localStorage.setItem('player-updated', new Date().toISOString());
      
      await loadTableData();
      onRefresh();
    } catch (err: any) {
      logError('Error removing player from seat:', err);
      showToast(err.message || 'Failed to remove player', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBombPotChange = async (value: number) => {
    if (value < 0 || value > 3) return;
    setBombPotCount(value);
    try {
      await updateTable(table.id, { bomb_pot_count: value } as any);
      onRefresh();
      showToast(`Bomb pot count updated to ${value}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update bomb pot count', 'error');
      setBombPotCount(table.bomb_pot_count ?? 1);
    }
  };

  const handleLockoutChange = async (value: number) => {
    if (value < 0 || value > 3) return;
    setLockoutCount(value);
    try {
      await updateTable(table.id, { lockout_count: value } as any);
      onRefresh();
      showToast(`Lockout count updated to ${value}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update lockout count', 'error');
      setLockoutCount(table.lockout_count ?? 0);
    }
  };

  const handleBuyInLimitsChange = async (newValue: string) => {
    const trimmedValue = newValue.trim();
    setBuyInLimits(trimmedValue);
    setIsEditingBuyIn(false);
    
    try {
      await updateTable(table.id, { buy_in_limits: trimmedValue || null } as any);
      
      // Broadcast update to TV view immediately
      try {
        const channel = new BroadcastChannel('tv-updates');
        channel.postMessage({
          type: 'table-update',
          tableId: table.id,
          buyInLimits: trimmedValue || null
        });
        channel.close();
      } catch (error) {
        logWarn('Failed to broadcast buy-in limits update:', error);
      }
      localStorage.setItem('tv-updated', new Date().toISOString());
      localStorage.setItem('table-updated', new Date().toISOString());
      
      onRefresh();
      showToast(`Buy-in limits updated`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update buy-in limits', 'error');
      setBuyInLimits(table.buy_in_limits || '');
    }
  };

  const handleBuyInLimitsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setBuyInLimits(table.buy_in_limits || '');
      setIsEditingBuyIn(false);
    }
  };

  const handleStakesChange = async (newValue: string) => {
    const trimmedValue = newValue.trim();
    setStakesText(trimmedValue);
    setIsEditingStakes(false);
    
    if (trimmedValue === (table.stakes_text || '')) return;
    
    try {
      await updateTable(table.id, { stakes_text: trimmedValue } as any);
      
      // Broadcast update to TV/public views immediately
      try {
        const channel = new BroadcastChannel('tv-updates');
        channel.postMessage({
          type: 'table-update',
          tableId: table.id,
          stakesText: trimmedValue
        });
        channel.close();
      } catch {}
      
      localStorage.setItem('table-updated', new Date().toISOString());
      onRefresh();
      showToast(`Stakes updated to ${trimmedValue}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update stakes', 'error');
      setStakesText(table.stakes_text || '');
    }
  };

  const handleStakesKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setStakesText(table.stakes_text || '');
      setIsEditingStakes(false);
    }
  };

  const handlePublicToggle = (value: boolean) => {
    setShowOnPublic(value);
    try {
      const hidden: string[] = JSON.parse(localStorage.getItem('hidden-from-public') || '[]');
      const updated = value ? hidden.filter(id => id !== table.id) : [...hidden, table.id];
      localStorage.setItem('hidden-from-public', JSON.stringify(updated));
      // Broadcast to public page
      try {
        const channel = new BroadcastChannel('public-updates');
        channel.postMessage({ type: 'public-toggle', tableId: table.id, showOnPublic: value });
        channel.close();
      } catch {}
      localStorage.setItem('public-updated', new Date().toISOString());
      showToast(`Public page visibility ${value ? 'enabled' : 'disabled'}`, 'success');
    } catch (err: any) {
      showToast('Failed to update public visibility', 'error');
      setShowOnPublic(!value);
    }
  };

  const handleTvToggle = async (value: boolean) => {
    setShowOnTv(value);
    try {
      await updateTable(table.id, { show_on_tv: value } as any);
      // Notify TV view for instant refresh (same-origin tabs/windows)
      try {
        const channel = new BroadcastChannel('tv-updates');
        channel.postMessage({ type: 'tv-toggle', tableId: table.id, showOnTv: value });
        channel.close();
      } catch {
        // BroadcastChannel not available; fall back to storage event
      }
      localStorage.setItem('tv-updated', new Date().toISOString());
      onRefresh();
      showToast(`TV visibility ${value ? 'enabled' : 'disabled'}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update TV visibility', 'error');
      setShowOnTv(table.show_on_tv ?? true);
    }
  };

  const handleRemoveWaitlist = async (waitlistId: string) => {
    const waitlist = waitlistPlayers.find(w => w.id === waitlistId);
    const confirmed = await showConfirmDialog({
      title: 'Remove from Waitlist',
      message: `Remove ${waitlist?.player?.nick || 'this player'} from waitlist?`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      type: 'warning',
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      const waitlist = waitlistPlayers.find(w => w.id === waitlistId);
      await removePlayerFromWaitlist(waitlistId, adminUser);
      
      // Broadcast update
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({
          type: 'player-update',
          action: 'remove',
          tableId: table.id,
          playerId: waitlist?.player_id,
          waitlistId: waitlistId // Include waitlist ID for removal tracking
        });
        channel.close();
      } catch (error) {
        logWarn('Failed to broadcast remove update:', error);
      }
      localStorage.setItem('player-updated', new Date().toISOString());
      
      await loadTableData();
      onRefresh();
      // Toast removed per user request
    } catch (err: any) {
      showToast(err.message || 'Failed to remove player', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToWaitlist = async (seat: TableSeat) => {
    const confirmed = await showConfirmDialog({
      title: 'Move to Waitlist',
      message: `Move ${seat.player?.nick || 'this player'} to waitlist?`,
      confirmText: 'Move',
      cancelText: 'Cancel',
      type: 'info',
    });
    if (!confirmed) return;
    
    const playerId = seat.player_id;
    
    // Prevent duplicate moves
    if (inFlightMovesRef.current.has(playerId)) {
      logWarn('Move already in flight for player:', playerId);
      return;
    }
    inFlightMovesRef.current.add(playerId);

    // Optimistic UI update - move immediately
    const optimisticSeated = seatedPlayers.filter(s => s.id !== seat.id);
    const optimisticWaitlist = [...waitlistPlayers];
    
    // Create optimistic waitlist entry (will be replaced by real data on refresh)
    const optimisticWaitlistEntry: TableWaitlist = {
      id: `temp-${Date.now()}`,
      club_day_id: clubDayId,
      table_id: table.id,
      player_id: seat.player_id,
      player: seat.player,
      position: waitlistPlayers.length + 1,
      added_at: new Date().toISOString(),
      removed_at: undefined,
      created_at: new Date().toISOString(),
    };
    optimisticWaitlist.push(optimisticWaitlistEntry);
    
    setSeatedPlayers(optimisticSeated);
    setWaitlistPlayers(optimisticWaitlist);

    // Run API calls in background
    (async () => {
      try {
        await removePlayerFromSeat(seat.id, table.id, adminUser);
        await addPlayerToWaitlist(table.id, seat.player_id, clubDayId, adminUser, { skipSeatCheck: true });
        
        // Broadcast update
        try {
          const channel = new BroadcastChannel('admin-updates');
          channel.postMessage({
            type: 'player-update',
            action: 'move',
            fromTableId: table.id,
            toTableId: table.id,
            playerId: seat.player_id,
            fromWaitlist: false,
            toWaitlist: true
          });
          channel.close();
        } catch (error) {
          logWarn('Failed to broadcast move update:', error);
        }
        localStorage.setItem('player-updated', new Date().toISOString());
        
        // Refresh data in background to sync with server
        await loadTableData();
        onRefresh();
        // Toast removed per user request
      } catch (err: any) {
        // Rollback optimistic update on error
        await loadTableData();
        logError('Move player error:', err);
        // Suppress alert - optimistic update already rolled back
      } finally {
        inFlightMovesRef.current.delete(playerId);
      }
    })();
  };

  // WL: Add player to another table's waitlist WITHOUT TC label (player stays at current table)
  const handleWaitlistAdd = async (player: TableSeat | TableWaitlist, targetTableId: string) => {
    const playerId = player.player_id;
    const targetTable = allTables.find(t => t.id === targetTableId);
    if (!targetTable) {
      showToast('Target table not found', 'error');
      return;
    }

    try {
      await addPlayerToWaitlist(targetTableId, playerId, clubDayId, adminUser, { skipSeatCheck: true });
      // NO TC label - this is a pure waitlist add
      // Broadcast update
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({
          type: 'player-update',
          action: 'waitlist-add',
          tableId: targetTableId,
          playerId,
        });
        channel.close();
      } catch {}
      localStorage.setItem('player-updated', new Date().toISOString());
      onRefresh();
    } catch (err: any) {
      showToast(err.message || `Failed to add to Table ${targetTable.table_number} waitlist`, 'error');
    }
  };

  const handleTableChange = async (player: TableSeat | TableWaitlist, newTableId: string, isFromWaitlist: boolean) => {
    const playerId = player.player_id;
    
    // Prevent duplicate moves
    if (inFlightMovesRef.current.has(playerId)) {
      logWarn('Move already in flight for player:', playerId);
      return;
    }
    inFlightMovesRef.current.add(playerId);

    const targetTable = allTables.find(t => t.id === newTableId);
    if (!targetTable) {
      inFlightMovesRef.current.delete(playerId);
      showToast('Target table not found', 'error');
      return;
    }

    // Optimistic UI update - remove from current table immediately
    let optimisticSeated: TableSeat[] = [...seatedPlayers];
    let optimisticWaitlist: TableWaitlist[] = [...waitlistPlayers];
    
    if (isFromWaitlist) {
      optimisticWaitlist = optimisticWaitlist.filter(w => w.id !== player.id);
    } else {
      optimisticSeated = optimisticSeated.filter(s => s.id !== player.id);
    }
    
    // Track this as an optimistic update (player being moved away)
    optimisticUpdatesRef.current.add(playerId);
    
    // Update state immediately for instant feedback
    setSeatedPlayers(optimisticSeated);
    setWaitlistPlayers(optimisticWaitlist);

    // Run API calls in background without blocking UI
    (async () => {
      try {
        // TC (same game type) = add to top of waitlist; different game type = add to bottom
        const isSameGameType = targetTable.game_type === table.game_type;
        await addPlayerToWaitlist(newTableId, player.player_id, clubDayId, adminUser, { skipSeatCheck: true, atTop: isSameGameType });

        // Write TC entry to localStorage so PublicPage/TVPage can show TC indicator
        try {
          const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
          const alreadyExists = tcList.some((entry: any) => entry.playerId === player.player_id && entry.tableNumber === targetTable.table_number);
          if (!alreadyExists) {
            tcList.push({ playerId: player.player_id, tableNumber: targetTable.table_number, fromTableNumber: table.table_number, timestamp: Date.now() });
            localStorage.setItem('tc-list', JSON.stringify(tcList));
          }
        } catch {}

        // Broadcast update
        try {
          const channel = new BroadcastChannel('admin-updates');
          channel.postMessage({ 
            type: 'player-update', 
            action: 'table-change', 
            fromTable: table.id, 
            toTable: newTableId, 
            playerId: player.player_id 
          });
          channel.close();
        } catch {}
        localStorage.setItem('player-updated', new Date().toISOString());

        // Refresh data in background to sync with server
        await loadTableData();
        onRefresh();
        // Toast removed per user request
      } catch (err: any) {
        // Rollback optimistic update on error
        await loadTableData();
        logError('Table change error:', err);
        showToast(err.message || 'Failed to add player to waitlist', 'error');
      } finally {
        inFlightMovesRef.current.delete(playerId);
      }
    })();
  };

  const handleQuickMove = async (player: TableSeat | TableWaitlist, newTableId: string, isFromWaitlist: boolean) => {
    const playerId = player.player_id;
    
    // Prevent duplicate moves
    if (inFlightMovesRef.current.has(playerId)) {
      logWarn('Move already in flight for player:', playerId);
      return;
    }
    inFlightMovesRef.current.add(playerId);

    // If moving from waitlist to seat, check if player has bought in
    if (isFromWaitlist) {
      let checkIn = null;
      try {
        checkIn = await getCheckInForPlayer(playerId, clubDayId);
      } catch { /* use default */ }

      if (!checkIn) {
        const playerName = player.player?.nick || player.player?.name || 'Unknown';
        showToast(`${playerName} must buy in before being seated`, 'error');
        inFlightMovesRef.current.delete(playerId);
        return;
      }
    }

    const targetTable = allTables.find(t => t.id === newTableId);
    if (!targetTable) {
      inFlightMovesRef.current.delete(playerId);
      alert('Target table not found');
      return;
    }

    // Optimistic UI update - update immediately
    let optimisticSeated: TableSeat[] = [...seatedPlayers];
    let optimisticWaitlist: TableWaitlist[] = [...waitlistPlayers];
    
    if (isFromWaitlist) {
      optimisticWaitlist = optimisticWaitlist.filter(w => w.id !== player.id);
    } else {
      optimisticSeated = optimisticSeated.filter(s => s.id !== player.id);
    }
    
    // Track this as an optimistic update (player being moved away)
    optimisticUpdatesRef.current.add(playerId);
    
    // Update state immediately for instant feedback
    setSeatedPlayers(optimisticSeated);
    setWaitlistPlayers(optimisticWaitlist);

    // Run API calls in background without blocking UI
    (async () => {
      try {
        if (isFromWaitlist) {
          const waitlist = player as TableWaitlist;
          await removePlayerFromWaitlist(waitlist.id, adminUser);
        } else {
          const seat = player as TableSeat;
          await removePlayerFromSeat(seat.id, table.id, adminUser);
        }

        const currentSeats = await getSeatedPlayersForTable(newTableId, clubDayId);
        if (currentSeats.length >= targetTable.seats_total) {
          await addPlayerToWaitlist(newTableId, player.player_id, clubDayId, adminUser);
        } else {
          await seatPlayer(newTableId, player.player_id, clubDayId);
        }

        // Broadcast update
        try {
          const channel = new BroadcastChannel('admin-updates');
          channel.postMessage({ type: 'player-update', action: 'move', fromTable: table.id, toTable: newTableId, playerId: player.player_id });
          channel.close();
        } catch {}
        localStorage.setItem('player-updated', new Date().toISOString());

        // Refresh data in background to sync with server
        await loadTableData();
        onRefresh();
        // Toast removed per user request
      } catch (err: any) {
        // Rollback optimistic update on error
        await loadTableData();
        logError('Move player error:', err);
        showToast(err.message || 'Failed to move player', 'error');
      } finally {
        inFlightMovesRef.current.delete(playerId);
      }
    })();
  };


  // Context menu handler
  const handleContextMenu = (e: React.MouseEvent, player: TableSeat | TableWaitlist, isFromWaitlist: boolean) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      player,
      isFromWaitlist,
    });
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  // Close table change menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (tableChangeMenu && !target.closest('.table-change-menu')) {
        setTableChangeMenu(null);
      }
    };
    if (tableChangeMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [tableChangeMenu]);

  // ============================================================================
  // 🔒 LOCKED: DRAG AND DROP FUNCTIONALITY
  // ============================================================================
  // This section contains the drag and drop implementation for moving players
  // between tables. This code is LOCKED and should NOT be modified without
  // explicit approval. The implementation includes:
  // - Optimistic UI updates to prevent players from disappearing
  // - Ref-based tracking to persist optimistic players across renders
  // - Broadcast channel communication for real-time updates
  // - Proper error handling and rollback mechanisms
  //
  // DO NOT EDIT THIS SECTION WITHOUT APPROVAL
  // ============================================================================

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, player: TableWaitlist | TableSeat, sourceTableId: string, isFromWaitlist: boolean) => {
    log('🔄 DRAG START - Player:', player.player_id, 'from table:', sourceTableId, 'waitlist:', isFromWaitlist);
    const dragData = {
      playerId: player.player_id,
      sourceTableId,
      isFromWaitlist,
      playerData: player
    };
    
    // Clear any previous in-flight moves for this player (in case of cancelled drag)
    const playerId = player.player_id;
    inFlightMovesRef.current.delete(playerId);
    
    // Set dragged player state immediately for drop zone hints
    setDraggedPlayer({ ...player, _sourceTableId: sourceTableId, _isFromWaitlist: isFromWaitlist });
    
    // Track that this player is being dragged (but don't remove from state yet)
    // The player stays in state and will only be removed when drop succeeds
    if (sourceTableId === table.id) {
      // Don't remove from state - just track that it's being dragged
      // This allows restoration if drag is cancelled
      optimisticUpdatesRef.current.add(playerId);
      log('✅ Marked player as being dragged');
    }
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    log('📦 Drag data set:', dragData);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    log('🔚 DRAG END - dropEffect:', e.dataTransfer.dropEffect);
    
    // Small delay to allow drop event to process first (drop fires before dragend)
    setTimeout(() => {
      // Check if drop actually happened
      // If dropEffect is 'move', drop was successful and handleDrop will clean up
      // If dropEffect is 'none' or empty, drag was cancelled
      const dropEffect = e.dataTransfer.dropEffect;
      
      if (!dropEffect || dropEffect === 'none') {
        // Drag was cancelled - clear drag state to restore visual appearance
        log('🔚 Drag cancelled - clearing drag state');
        
        // Get player info from draggedPlayer state
        if (draggedPlayer) {
          const playerId = draggedPlayer.player_id;
          
          // Clear all tracking for this player
          optimisticUpdatesRef.current.delete(playerId);
          inFlightMovesRef.current.delete(playerId);
          
          log('🔄 Cleared all tracking for cancelled drag:', playerId);
        }
        
        // Clear drag state (player will reappear since it's still in state)
        setDraggedPlayer(null);
        setDragOverTarget(null);
      } else {
        // Drop succeeded, state will be cleared in handleDrop
        log('🔚 Drop succeeded, state will be cleared in handleDrop');
      }
    }, 150);
  };

  const handleDragOver = (e: React.DragEvent, target: 'seated' | 'waitlist') => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragOverTarget(target);
    
    // Visual feedback for valid drop zones
    // Use real count (excluding optimistic) to match display
    const realSeatedCount = seatedPlayers.filter(s => !s.id.startsWith('temp-')).length;
    if (target === 'seated' && realSeatedCount >= table.seats_total) {
      e.dataTransfer.dropEffect = 'none';
    } else {
      // Always allow drops on waitlist (no capacity limit)
      // Allow drops on seated if not full
      e.dataTransfer.dropEffect = 'move';
    }
    
    log('🎯 DRAG OVER - Table:', table.id, 'Target:', target, 'DropEffect:', e.dataTransfer.dropEffect);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving the drop zone
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverTarget(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, target: 'seated' | 'waitlist' = 'seated') => {
    e.preventDefault();
    log('🎯 DROP EVENT - Target:', target, 'Table:', table.id);

    // Try to get data from dataTransfer first
    let transferData = null;
    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (rawData) {
        transferData = JSON.parse(rawData);
        log('📦 Transfer data received:', transferData);
      }
    } catch (error) {
      logError('❌ Error parsing transfer data:', error);
    }

    log('👤 Current draggedPlayer state:', draggedPlayer);

    if (!draggedPlayer && !transferData) {
      log('❌ No draggedPlayer or transfer data, returning');
      return;
    }

    // Extract data from either transferData or draggedPlayer state
    let actualPlayerData;
    let sourceTableId;
    let isFromWaitlist;
    let playerId;

    if (transferData) {
      // Data came from dataTransfer
      actualPlayerData = transferData.playerData;
      sourceTableId = transferData.sourceTableId;
      isFromWaitlist = transferData.isFromWaitlist;
      playerId = transferData.playerId;
      log('📦 Using transfer data:', transferData);
    } else if (draggedPlayer) {
      // Data came from component state
      actualPlayerData = draggedPlayer;
      sourceTableId = draggedPlayer._sourceTableId || table.id;
      isFromWaitlist = draggedPlayer._isFromWaitlist || false;
      playerId = draggedPlayer.player_id;
      log('👤 Using state data:', draggedPlayer);
    } else {
      logError('❌ No player data available');
      alert('No player data available for drag operation');
      return;
    }

    log('🔍 Extracted data - PlayerID:', playerId, 'SourceTable:', sourceTableId, 'FromWaitlist:', isFromWaitlist, 'PlayerData:', actualPlayerData);

    if (!actualPlayerData || !playerId || !actualPlayerData.id) {
      logError('❌ Missing required data for drop operation - actualPlayerData:', actualPlayerData, 'playerId:', playerId);
      alert('Missing player data for move operation');
      return;
    }

    // If dropping from waitlist to seat, check if player has bought in
    if (isFromWaitlist && target === 'seated') {
      let checkIn = null;
      try {
        checkIn = await getCheckInForPlayer(playerId, clubDayId);
      } catch { /* use default */ }
      if (!checkIn) {
        const playerName = actualPlayerData.player?.nick || actualPlayerData.player?.name || 'Unknown';
        showToast(`${playerName} must buy in before being seated`, 'error');
        setDraggedPlayer(null);
        setDragOverTarget(null);
        return;
      }
    }

    // Ensure we have player object - if missing, try to get it from actualPlayerData or create minimal one
    let playerObj = actualPlayerData.player;
    if (!playerObj && actualPlayerData.player_id) {
      // Try to find player in existing seats/waitlists
      const allSeats = [...seatedPlayers, ...waitlistPlayers];
      const existingEntry = allSeats.find(s => s.player_id === actualPlayerData.player_id);
      if (existingEntry?.player) {
        playerObj = existingEntry.player;
      } else {
        // Create minimal player object as fallback
        playerObj = {
          id: actualPlayerData.player_id,
          name: actualPlayerData.player?.name || 'Unknown',
          nick: actualPlayerData.player?.nick || 'Unknown',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
    }

    log('🎯 Processing drop - Player:', playerId, 'Source:', sourceTableId, 'FromWaitlist:', isFromWaitlist, 'Target:', target, 'PlayerObj:', playerObj);

    // Don't allow dropping on the same table and same list type
    if (sourceTableId === table.id && isFromWaitlist === (target === 'waitlist')) {
      log('🚫 Same table same list type drop, ignoring');
      setDraggedPlayer(null);
      // Clear any tracking for this cancelled drop
      inFlightMovesRef.current.delete(playerId);
      optimisticUpdatesRef.current.delete(playerId);
      return;
    }

    // Always clear any existing in-flight move for this player first
    // This ensures we start with a clean state and allows retries
    if (inFlightMovesRef.current.has(playerId)) {
      log('⚠️ Clearing existing in-flight move for player:', playerId);
      inFlightMovesRef.current.delete(playerId);
    }
    
    // Clear any stale optimistic updates for this player at destination table
    // (they might have been tracked from a previous failed move)
    if (sourceTableId !== table.id) {
      optimisticUpdatesRef.current.delete(playerId);
    }
    
    // Now add this move as in-flight
    inFlightMovesRef.current.add(playerId);

    // Optimistic UI update - update immediately for instant feedback
    let optimisticSeated: TableSeat[] = [...seatedPlayers];
    let optimisticWaitlist: TableWaitlist[] = [...waitlistPlayers];
    
    // CRITICAL: Always remove player from this table's lists if they're being moved
    // This prevents ghosting - if player is moving away, remove them immediately
    // Also ensure we're removing from BOTH source and destination tables to prevent any ghosting
    if (sourceTableId === table.id) {
      // Player is being moved FROM this table - remove them immediately
      log('🗑️ Removing player from source table (this table):', playerId);
      if (isFromWaitlist) {
        optimisticWaitlist = optimisticWaitlist.filter(w => w.id !== actualPlayerData.id && w.player_id !== playerId);
      } else {
        optimisticSeated = optimisticSeated.filter(s => s.id !== actualPlayerData.id && s.player_id !== playerId);
      }
    } else {
      // Player is being moved FROM another table TO this table
      // Remove them from this table's lists if they somehow exist (safety check)
      log('🗑️ Removing player from destination table (this table) if exists:', playerId);
      optimisticSeated = optimisticSeated.filter(s => s.player_id !== playerId);
      optimisticWaitlist = optimisticWaitlist.filter(w => w.player_id !== playerId);
    }
    
    // CRITICAL: Also ensure source table removes player immediately via broadcast
    // This ensures the source table (if different) also removes the player instantly
    if (sourceTableId !== table.id) {
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({
          type: 'player-update',
          action: 'remove-immediate',
          fromTableId: sourceTableId,
          playerId: playerId,
          fromWaitlist: isFromWaitlist
        });
        channel.close();
        localStorage.setItem('player-update-data', JSON.stringify({
          type: 'player-update',
          action: 'remove-immediate',
          fromTableId: sourceTableId,
          playerId: playerId,
          fromWaitlist: isFromWaitlist
        }));
      } catch (error) {
        logWarn('Failed to broadcast immediate removal:', error);
      }
    }
    
    // Add to target optimistically
    // CRITICAL: Count only real players (excluding optimistic) to match display count
    const realSeatedCount = optimisticSeated.filter(s => !s.id.startsWith('temp-')).length;
    if (target === 'seated' && realSeatedCount < table.seats_total) {
      // Create optimistic seat entry
      const optimisticSeat: TableSeat = {
        id: `temp-${Date.now()}`,
        club_day_id: clubDayId,
        table_id: table.id,
        player_id: playerId,
        player: playerObj,
        seated_at: new Date().toISOString(),
        left_at: undefined,
        created_at: new Date().toISOString(),
      };
      optimisticSeated.push(optimisticSeat);
      log('✅ Optimistically added player to seated:', optimisticSeat);
    } else if (target === 'waitlist') {
      // Create optimistic waitlist entry
      const optimisticWaitlistEntry: TableWaitlist = {
        id: `temp-${Date.now()}`,
        club_day_id: clubDayId,
        table_id: table.id,
        player_id: playerId,
        player: playerObj,
        position: optimisticWaitlist.length + 1,
        added_at: new Date().toISOString(),
        removed_at: undefined,
        created_at: new Date().toISOString(),
      };
      optimisticWaitlist.push(optimisticWaitlistEntry);
      log('✅ Optimistically added player to waitlist:', optimisticWaitlistEntry);
    }
    
    // Track optimistic update
    optimisticUpdatesRef.current.add(playerId);
    
    // Store optimistic players in ref so they persist across renders
    optimisticPlayersRef.current = {
      seated: optimisticSeated.filter(s => s.id.startsWith('temp-')),
      waitlist: optimisticWaitlist.filter(w => w.id.startsWith('temp-'))
    };
    
    // Update state immediately for instant feedback
    log('🔄 Updating state optimistically - Seated:', optimisticSeated.length, 'Waitlist:', optimisticWaitlist.length);
    setSeatedPlayers(optimisticSeated);
    setWaitlistPlayers(optimisticWaitlist);
    // Clear drag state immediately to prevent re-dragging
    setDraggedPlayer(null);
    setDragOverTarget(null);
    
    log('✅ State updated - player should now appear at destination');

    // Run API calls in background without blocking UI
    (async () => {
      try {
        log('🚀 Starting move operation - Player:', playerId, 'from table:', sourceTableId, 'to table:', table.id, 'target:', target);

      // Handle different move types based on source and target
      if (target === 'seated') {
        log('💺 Target: Seated - Current seated:', seatedPlayers.length, 'Capacity:', table.seats_total);
        
        // CRITICAL: Check if player is already seated at another table (before removing from source)
        // This prevents double-seating if moving from waitlist to seat
        if (!isFromWaitlist) {
          // If moving from seat to seat, we'll remove from source first, so this check happens in seatPlayer
          // But if moving from waitlist, we need to check first
        } else {
          // Moving from waitlist to seat - check if already seated elsewhere
          const existingSeats = await getSeatedPlayersForPlayer(playerId, clubDayId);
          if (existingSeats.length > 0) {
          const existingSeat = existingSeats[0];
          const sourceTable = allTables.find(t => t.id === existingSeat.table_id);
          const tableNum = sourceTable?.table_number || 'unknown';
          // Clear optimistic update tracking and in-flight move
          optimisticUpdatesRef.current.delete(playerId);
          inFlightMovesRef.current.delete(playerId);
          // Clear drag state
          setDraggedPlayer(null);
          setDragOverTarget(null);
          // Rollback optimistic update (skip cooldown for immediate rollback)
          await loadTableData(true);
          alert(`Cannot seat player: They are already seated at Table ${tableNum}. Remove them from that table first.`);
          return;
          }
        }
        
        // Check if table is full (count only real players, excluding optimistic)
        const realSeatedCount = optimisticSeated.filter(s => !s.id.startsWith('temp-')).length;
        if (realSeatedCount >= table.seats_total) {
          log('❌ Table full, aborting');
          // Clear optimistic update tracking and in-flight move
          optimisticUpdatesRef.current.delete(playerId);
          inFlightMovesRef.current.delete(playerId);
          // Clear drag state
          setDraggedPlayer(null);
          setDragOverTarget(null);
          // Rollback optimistic update (skip cooldown for immediate rollback)
          await loadTableData(true);
          alert(`Table is full (${realSeatedCount}/${table.seats_total} seats)`);
          return;
        }

        if (isFromWaitlist) {
          // Moving from waitlist to seat
          let waitlistEntryId = actualPlayerData.id;
          
          // If we have a temp ID, try to find the real waitlist entry ID
          if (waitlistEntryId.startsWith('temp-')) {
            log('⚠️ Temp ID detected, finding real waitlist entry for player:', playerId, 'at table:', sourceTableId);
            try {
              const sourceWaitlist = await getWaitlistForTable(sourceTableId, clubDayId);
              const realEntry = sourceWaitlist.find(w => w.player_id === playerId);
              if (realEntry) {
                waitlistEntryId = realEntry.id;
                log('✅ Found real waitlist entry ID:', waitlistEntryId);
              } else {
                log('⚠️ No waitlist entry found - player may have already been removed');
              }
            } catch (error) {
              logWarn('Error finding real waitlist entry:', error);
            }
          }
          
          // If moving from a different table's waitlist, remove it manually first
          // Otherwise, seatPlayer will handle removing from waitlist at the same table
          if (sourceTableId !== table.id && !waitlistEntryId.startsWith('temp-')) {
            log('📋 Removing from waitlist at source table:', sourceTableId, 'Waitlist ID:', waitlistEntryId);
            await removePlayerFromWaitlist(waitlistEntryId, adminUser);
          }
          
          log('💺 Seating player at table:', table.id);
          // seatPlayer will automatically remove from waitlist if player is waitlisted at this table
          const seatResult = await seatPlayer(table.id, playerId, clubDayId);
          log('💺 Seat result:', seatResult);
          
          // CRITICAL: Verify the seat was actually created on the server
          // Retry verification up to 3 times with exponential backoff
          let verified = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, attempt))); // 200ms, 400ms, 800ms
            const verifySeats = await getSeatedPlayersForTable(table.id, clubDayId);
            if (verifySeats.some(s => s.player_id === playerId && s.id === seatResult.id)) {
              verified = true;
              log('✅ Verified seat creation on server:', seatResult.id);
              break;
            }
            log(`⏳ Verification attempt ${attempt + 1}/3: Seat not yet visible on server, retrying...`);
          }
          
          if (!verified) {
            logWarn('⚠️ Seat created but not yet visible on server - keeping optimistic update');
            // Keep optimistic update - server will catch up
          }
          
          log('✅ Moved from waitlist to seat');
        } else {
          // Moving from one seat to another seat (cross-table)
          log('💺 Removing from seat ID:', actualPlayerData.id, 'at table:', sourceTableId);
          const removeResult = await removePlayerFromSeat(actualPlayerData.id, sourceTableId, adminUser);
          log('💺 Remove result:', removeResult);
          log('💺 Seating player at table:', table.id);
          const seatResult = await seatPlayer(table.id, playerId, clubDayId);
          log('💺 Seat result:', seatResult);
          
          // CRITICAL: Verify the seat was actually created on the server
          // Retry verification up to 3 times with exponential backoff
          let verified = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, attempt))); // 200ms, 400ms, 800ms
            const verifySeats = await getSeatedPlayersForTable(table.id, clubDayId);
            if (verifySeats.some(s => s.player_id === playerId && s.id === seatResult.id)) {
              verified = true;
              log('✅ Verified seat creation on server:', seatResult.id);
              break;
            }
            log(`⏳ Verification attempt ${attempt + 1}/3: Seat not yet visible on server, retrying...`);
          }
          
          if (!verified) {
            logWarn('⚠️ Seat created but not yet visible on server - keeping optimistic update');
            // Keep optimistic update - server will catch up
          }
          
          log('✅ Moved from seat to seat');
        }
      } else if (target === 'waitlist') {
        // Target is waitlist - always allow (no capacity limits for waitlists)
        log('📋 Target: Waitlist');
        if (isFromWaitlist) {
          // Moving from one waitlist to another waitlist
          log('📋 Removing from waitlist ID:', actualPlayerData.id);
          const removeResult = await removePlayerFromWaitlist(actualPlayerData.id, adminUser);
          log('📋 Remove result:', removeResult);
          log('📋 Adding to waitlist at table:', table.id);
          const addResult = await addPlayerToWaitlist(table.id, playerId, clubDayId, adminUser, { skipSeatCheck: true });
          log('📋 Add result:', addResult);
          log('✅ Moved from waitlist to waitlist');
        } else {
          // Moving from seat to waitlist
          log('💺 Removing from seat ID:', actualPlayerData.id, 'at table:', sourceTableId);
          const removeResult = await removePlayerFromSeat(actualPlayerData.id, sourceTableId, adminUser);
          log('💺 Remove result:', removeResult);
          log('📋 Adding to waitlist at table:', table.id);
          const addResult = await addPlayerToWaitlist(table.id, playerId, clubDayId, adminUser);
          log('📋 Add result:', addResult);
          log('✅ Moved from seat to waitlist');
        }
      }

      // Broadcast player update for real-time refresh (both source and destination tables)
      log('📡 Broadcasting update - from:', sourceTableId, 'to:', table.id, 'player:', playerId);
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({
          type: 'player-update',
          action: 'move',
          fromTableId: sourceTableId,
          toTableId: table.id,
          playerId: playerId,
          fromWaitlist: isFromWaitlist,
          toWaitlist: target === 'waitlist'
        });
        channel.close();
        log('📡 Broadcast sent successfully');
      } catch (error) {
        logWarn('📡 BroadcastChannel not available, using localStorage:', error);
      }
      localStorage.setItem('player-updated', new Date().toISOString());

        // Wait for server to process the change before refreshing
        // This ensures the optimistic update is visible and gives server time to process
        log('⏳ Waiting for server to process move...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Refresh data in background to sync with server (skip cooldown for immediate refresh)
        // This will merge optimistic data with real server data (optimistic players stay until server confirms)
        log('🔄 Refreshing table data to sync with server...');
        await loadTableData(true);
        
        // If player still has optimistic update after refresh, do another refresh after delay
        // This handles cases where server processing takes longer
        // CRITICAL: DO NOT clear optimistic tracking here - keep player visible until server confirms
        if (optimisticUpdatesRef.current.has(playerId)) {
          log('⏳ Player still has optimistic update, waiting for server to catch up...');
          setTimeout(async () => {
            await loadTableData(true);
            // CRITICAL: Check if server now shows the player before clearing tracking
            const currentSeated = await getSeatedPlayersForTable(table.id, clubDayId);
            const currentWaitlist = await getWaitlistForTable(table.id, clubDayId);
            const isSeatedHere = currentSeated.some(s => s.player_id === playerId);
            const isWaitlistedHere = currentWaitlist.some(w => w.player_id === playerId);
            
            if (isSeatedHere || isWaitlistedHere) {
              log('✅ Server confirmed player after second refresh, clearing tracking');
              optimisticUpdatesRef.current.delete(playerId);
              inFlightMovesRef.current.delete(playerId);
            } else {
              logWarn('⚠️ Player still not confirmed by server after second refresh, keeping optimistic update');
              // Keep optimistic update - don't clear tracking, player might still be processing
            }
          }, 2000);
        }
        
        // Also refresh the source table if it's different
        if (sourceTableId !== table.id) {
          log('🔄 Also refreshing source table:', sourceTableId);
          // Trigger refresh for source table via broadcast with delay
          setTimeout(() => {
            try {
              const refreshChannel = new BroadcastChannel('admin-updates');
              refreshChannel.postMessage({
                type: 'player-update',
                action: 'refresh-table',
                tableId: sourceTableId
              });
              refreshChannel.close();
            } catch (error) {
              logWarn('Failed to broadcast source table refresh:', error);
            }
          }, 300);
        }
        
        // CRITICAL: Only clear optimistic updates if server confirms the player is at this table
        // Verify player is actually seated/waitlisted at this table before clearing
        const currentSeated = await getSeatedPlayersForTable(table.id);
        const currentWaitlist = await getWaitlistForTable(table.id);
        const isSeatedHere = currentSeated.some(s => s.player_id === playerId);
        const isWaitlistedHere = currentWaitlist.some(w => w.player_id === playerId);
        
        if (isSeatedHere || isWaitlistedHere) {
          // Server confirms player is here - safe to clear optimistic updates
          log('✅ Server confirms player is at this table, clearing optimistic updates');
          optimisticUpdatesRef.current.delete(playerId);
          inFlightMovesRef.current.delete(playerId);
          
          // Clear optimistic players from ref
          optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
          optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
          saveOptimisticPlayers(); // Update localStorage
        } else {
          // Server doesn't show player yet - keep optimistic update for now
          logWarn('⚠️ Server does not yet show player at this table, keeping optimistic update');
          // Keep optimistic tracking - will be cleared when server confirms
          // Don't clear inFlightMovesRef yet - wait for server confirmation
        }
        
        // Ensure drag state is cleared
        setDraggedPlayer(null);
        setDragOverTarget(null);
        
        log('🔄 Calling parent refresh...');
        onRefresh();
        log('✅ Move operation completed successfully');
      } catch (err: any) {
        logError('❌ Drop player error:', err);

        // Clear optimistic update tracking
        optimisticUpdatesRef.current.delete(playerId);
        
        // Clear optimistic players from ref
        optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
        optimisticPlayersRef.current.waitlist = optimisticPlayersRef.current.waitlist.filter(w => w.player_id !== playerId);
        saveOptimisticPlayers(); // Update localStorage
        
        // Rollback optimistic update on error (skip cooldown for immediate rollback)
        await loadTableData(true);

        // Handle specific validation errors with user-friendly messages
        // Only show alerts for important validation errors, suppress generic errors
        if (err.message?.includes('already seated at Table')) {
          // This is the double-seating prevention error - important to show
          alert(err.message);
        } else if (err.message?.includes('already seated at this table')) {
          alert('Player is already seated at this table');
        } else if (err.message?.includes('cannot be added to the waitlist')) {
          alert('Player cannot be added to waitlist - already seated at this table');
        } else {
          // Suppress generic "Failed to move player" - optimistic update already rolled back
          logError('Move operation failed:', err.message || err);
        }
      } finally {
        if (playerId) {
          inFlightMovesRef.current.delete(playerId);
        }
        log('🧹 Cleaned up drag state');
      }
    })();
  };
  // ============================================================================
  // 🔒 END OF LOCKED DRAG AND DROP SECTION
  // ============================================================================

  const handleRemoveTable = async () => {
    const playerCount = seatedPlayers.length + activeWaitlistPlayers.length;
    
    if (playerCount > 0) {
      // If there are players, offer options: break table or delete with all players
      const breakTable = confirm(
        `This table has ${playerCount} player(s).\n\n` +
        `Click OK to open Break Table dialog (move players to another table).\n` +
        `Click Cancel to delete the table and remove all players.`
      );
      
      if (breakTable) {
        // User wants to break table - open break table modal
        if (onBreakTable) {
          onBreakTable(table.id);
        } else {
          alert('Break table functionality not available');
        }
        return;
      } else {
        // User wants to delete table and remove all players
        const confirmDelete = confirm(
          `⚠️ WARNING: Delete Table and Remove All Players\n\n` +
          `This will permanently delete Table ${table.table_number} and remove all ${playerCount} player(s) from the table.\n\n` +
          `This action cannot be undone. Continue?`
        );
        
        if (!confirmDelete) return;
      }
    } else {
      // No players - just confirm deletion
      if (!confirm(`Remove Table ${table.table_number}?`)) return;
    }
    
    setLoading(true);
    try {
      await deleteTable(table.id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to remove table');
      setLoading(false);
    }
  };

  const waitlistCount = activeWaitlistPlayers.length;

  // CRITICAL: Display list includes optimistic players (for drag and drop to work)
  // But count excludes optimistic players (to match TV page)
  // Separate concerns: display vs count
  const displayedSeatedPlayers = useMemo(() => {
    // CRITICAL: Deduplicate by player_id (same logic as getTableCounts)
    // When duplicates exist, keep the one with the earliest seated_at time
    // IMPORTANT: Include ALL players (including optimistic) for display so drag/drop works
    const uniqueMap = new Map<string, TableSeat>();
    
    for (const seat of seatedPlayers) {
      if (!uniqueMap.has(seat.player_id)) {
        uniqueMap.set(seat.player_id, seat);
      } else {
        // If duplicate, keep the one with the earlier seated_at time (consistent with getTableCounts)
        const existing = uniqueMap.get(seat.player_id)!;
        const existingTime = new Date(existing.seated_at).getTime();
        const currentTime = new Date(seat.seated_at).getTime();
        if (currentTime < existingTime) {
          uniqueMap.set(seat.player_id, seat);
        }
      }
    }
    
    return Array.from(uniqueMap.values());
  }, [seatedPlayers]);
  
  // CRITICAL: Count excludes optimistic players to match TV page exactly
  // This is used for the header count display
  const seatedCountForDisplay = useMemo(() => {
    // Filter out optimistic/temp entries for count (matches TV page logic)
    const realEntries = displayedSeatedPlayers.filter(seat => !seat.id.startsWith('temp-'));
    
    // Debug logging for Table 14 specifically
    if (table.table_number === 14) {
      log(`📊 Table 14 Admin Count: seatedCountForDisplay=${realEntries.length}, displayedSeatedPlayers=${displayedSeatedPlayers.length}, optimistic=${displayedSeatedPlayers.length - realEntries.length}`);
      // Check for duplicates
      const playerIdCounts = new Map<string, number>();
      realEntries.forEach(seat => {
        playerIdCounts.set(seat.player_id, (playerIdCounts.get(seat.player_id) || 0) + 1);
      });
      const duplicates = Array.from(playerIdCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        log(`⚠️ Table 14 Admin: Found ${duplicates.length} duplicate player(s):`, duplicates.map(([pid, count]) => `Player ${pid} (${count} seats)`));
      }
    }
    
    return realEntries.length;
  }, [displayedSeatedPlayers, table.table_number]);

  // Use count (without optimistic) for table state checks
  const tableIsFull = seatedCountForDisplay >= table.seats_total;
  const tableIsEmpty = seatedCountForDisplay === 0;

  // Get game type for color coding
  const gameTypeClass = table.game_type?.toLowerCase() || 'other';
  
  return (
    <div className={`table-card ${table.status.toLowerCase()} ${tableIsEmpty ? 'empty-table' : ''} ${tableIsFull ? 'full-table' : ''} game-type-${gameTypeClass}${(isPersistent || table.is_persistent) ? ' persistent' : ''}`}>
      <div className="table-header">
        <div className="table-number">
          {isEditingTableNumber ? (
            <span className="table-number-edit-inline">
              Table{' '}
              <input
                type="number"
                className="table-number-input"
                value={editTableNumber}
                onChange={(e) => setEditTableNumber(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const newNum = parseInt(editTableNumber, 10);
                    if (!newNum || newNum < 1) {
                      showToast('Invalid table number', 'error');
                      setEditTableNumber(table.table_number.toString());
                      setIsEditingTableNumber(false);
                      return;
                    }
                    if (newNum === table.table_number) {
                      setIsEditingTableNumber(false);
                      return;
                    }
                    const conflict = allTables.find(t => t.table_number === newNum && t.id !== table.id);
                    if (conflict) {
                      showToast(`Table ${newNum} already exists`, 'error');
                      setEditTableNumber(table.table_number.toString());
                      setIsEditingTableNumber(false);
                      return;
                    }
                    try {
                      await updateTable(table.id, { table_number: newNum });
                      showToast(`Table ${table.table_number} → Table ${newNum}`, 'success');
                      setIsEditingTableNumber(false);
                      onRefresh();
                    } catch (err: any) {
                      showToast(err.message || 'Failed to update table number', 'error');
                      setEditTableNumber(table.table_number.toString());
                      setIsEditingTableNumber(false);
                    }
                  } else if (e.key === 'Escape') {
                    setEditTableNumber(table.table_number.toString());
                    setIsEditingTableNumber(false);
                  }
                }}
                onBlur={() => {
                  setEditTableNumber(table.table_number.toString());
                  setIsEditingTableNumber(false);
                }}
                autoFocus
                min="1"
                max="99"
              />
            </span>
          ) : (
            <span
              className="table-number-clickable"
              title="Click to change table number"
              onClick={() => {
                setEditTableNumber(table.table_number.toString());
                setIsEditingTableNumber(true);
              }}
            >
              Table {table.table_number}
            </span>
          )}
          <span className="seated-count">({seatedCountForDisplay})</span>
          {(isPersistent || table.is_persistent) && <span className="persistent-label">Pre-Sign Up</span>}
          {(isPersistent || table.is_persistent) && (
            <button
              className={`persistent-refresh-btn${refreshing ? ' spinning' : ''}`}
              title="Refresh waitlist & pending signups"
              onClick={async (e) => {
                e.stopPropagation();
                setRefreshing(true);
                await loadTableData(true);
                onRefresh();
                setRefreshing(false);
              }}
              disabled={loading}
            >
              ↻
            </button>
          )}
        </div>
        <div className="table-header-actions">
          {onDuplicateTable && (
            <Tooltip content="Duplicate this table with a new number">
              <button
                className="duplicate-table-icon"
                onClick={() => onDuplicateTable(table)}
              >
                Dupe
              </button>
            </Tooltip>
          )}
          {onHideTable && (
            <Tooltip content="Hide this table from view">
              <button
                className="hide-table-icon"
                onClick={() => onHideTable(table.id)}
              >
                Hide
              </button>
            </Tooltip>
          )}
          <Tooltip content={showOnPublic ? 'Hide from public page' : 'Show on public page'}>
            <button
              className={`public-toggle-icon ${showOnPublic ? 'active' : ''}`}
              onClick={() => handlePublicToggle(!showOnPublic)}
              disabled={loading}
            >
              Public
            </button>
          </Tooltip>
          <Tooltip content={showOnTv ? 'Hide from TV display' : 'Show on TV display'}>
            <button
              className={`tv-toggle-icon ${showOnTv ? 'active' : ''}`}
              onClick={() => handleTvToggle(!showOnTv)}
              disabled={loading}
            >
              Cast
            </button>
          </Tooltip>
          <div className="table-status-badges">
            {table.status.toLowerCase() !== 'open' && (
              <div className={`table-status ${table.status.toLowerCase()}`}>{table.status}</div>
            )}
            {tableIsFull && (
              <Tooltip content="All seats are filled">
                <span className="status-badge badge-full">Full</span>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <button className="table-options-toggle" onClick={() => setShowOptions(!showOptions)}>
        <span className={`table-options-arrow ${showOptions ? '' : 'collapsed'}`}>▼</span>
        {showOptions ? 'Hide Options' : 'Options'}
      </button>

      {showOptions && (
        <>
          <div className="table-info">
            <div className="info-badge game-type">
              {highlightAllMatches(table.game_type || '', searchQuery)}
            </div>
            <div 
              className="info-badge stakes clickable"
              onClick={() => !loading && setIsEditingStakes(true)}
              title="Click to edit stakes"
            >
              {isEditingStakes ? (
                <input
                  type="text"
                  value={stakesText}
                  onChange={(e) => setStakesText(e.target.value)}
                  onBlur={() => handleStakesChange(stakesText)}
                  onKeyDown={handleStakesKeyDown}
                  className="stakes-input"
                  autoFocus
                  disabled={loading}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="stakes-text">
                  {highlightAllMatches(stakesLabel, searchQuery)}
                </span>
              )}
            </div>
            <div 
              className="info-badge buy-in-limits clickable"
              onClick={() => !loading && setIsEditingBuyIn(true)}
              title="Click to edit buy-in limits"
            >
              {isEditingBuyIn ? (
                <input
                  type="text"
                  value={buyInLimits}
                  onChange={(e) => setBuyInLimits(e.target.value)}
                  onBlur={() => handleBuyInLimitsChange(buyInLimits)}
                  onKeyDown={handleBuyInLimitsKeyDown}
                  className="buy-in-input"
                  autoFocus
                  disabled={loading}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="buy-in-text">
                  {buyInLimits || 'Set buy-in limits'}
                </span>
              )}
            </div>
            <div className="info-badge bomb-pots">
              Bomb Pots:
              <select
                value={bombPotCount}
                onChange={(e) => handleBombPotChange(parseInt(e.target.value))}
                className="bomb-pot-select"
                disabled={loading}
              >
                {Array.from({ length: 4 }, (_, i) => i).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="info-badge lockouts">
              Lockouts:
              <select
                value={lockoutCount}
                onChange={(e) => handleLockoutChange(parseInt(e.target.value))}
                className="lockout-select"
                disabled={loading}
              >
                {Array.from({ length: 4 }, (_, i) => i).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="table-actions">
            <Tooltip content={waitlistCount === 0 ? 'No players on waitlist' : tableIsFull ? 'Table is full' : 'Seat the next player from waitlist'}>
              <button
                onClick={handleSeatNext}
                disabled={loading || waitlistCount === 0 || tableIsFull}
                className="btn-seat-next"
              >
                Seat Next
              </button>
            </Tooltip>
            <Tooltip content={waitlistCount === 0 ? 'No players on waitlist' : tableIsFull ? 'Table is full' : 'Seat all bought-in waitlist players (up to available seats)'}>
              <button
                onClick={handleQuickSeat}
                disabled={loading || waitlistCount === 0 || tableIsFull}
                className="btn-quick-seat"
              >
                Quick Seat
              </button>
            </Tooltip>
            <button
              onClick={handleRemoveTable}
              disabled={loading}
              className="btn-remove-table"
            >
              Remove Table
            </button>
          </div>
        </>
      )}

      <div className="table-lists">
        <div
          className={`seated-list ${dragOverTarget === 'seated' ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            handleDragOver(e, 'seated');
          }}
          onDragLeave={handleDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(e, 'seated');
          }}
        >
          <h4>
            Seated Players {draggedPlayer && <span className="drop-hint">(Drop to seat)</span>}
            {searchQuery && displayedSeatedPlayers.filter((seat) => {
              const query = searchQuery.toLowerCase();
              return (
                seat.player?.nick?.toLowerCase().includes(query) ||
                seat.player?.name?.toLowerCase().includes(query) ||
                seat.player_id.toLowerCase().includes(query)
              );
            }).length === 0 && displayedSeatedPlayers.length > 0 && (
              <span className="search-no-match"> (No matches)</span>
            )}
          </h4>
          {displayedSeatedPlayers.length === 0 ? (
            <div className="empty-list drop-zone">
              {draggedPlayer ? 'Drop player here to seat' : 'No players seated'}
            </div>
          ) : displayedSeatedPlayers.filter((seat) => {
              if (!searchQuery) return true;
              const query = searchQuery.toLowerCase();
              return (
                seat.player?.nick?.toLowerCase().includes(query) ||
                seat.player?.name?.toLowerCase().includes(query) ||
                seat.player_id.toLowerCase().includes(query)
              );
            }).length === 0 ? (
            <div className="empty-list">
              No players match "{searchQuery}"
            </div>
          ) : (
            displayedSeatedPlayers
              .filter((seat) => {
                if (!searchQuery) return true;
                const query = searchQuery.toLowerCase();
                return (
                  seat.player?.nick?.toLowerCase().includes(query) ||
                  seat.player?.name?.toLowerCase().includes(query) ||
                  seat.player_id.toLowerCase().includes(query)
                );
              })
              .map((seat) => {
                const assignment = playerAssignments.get(seat.player_id);
                const selectedEntry = selectedPlayers[seat.player_id];
                const isSelected = selectedEntry?.entryId === seat.id;
                // Don't apply dragging class during drag to avoid interfering with browser drag operation
                return (
                <div
                  key={`seat-${seat.player_id}-${seat.id}`}
                  className={`player-item ${isSelected ? 'selected' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, seat, table.id, false)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => handleContextMenu(e, seat, false)}
                >
                  <input
                    type="checkbox"
                    className="player-select"
                    checked={isSelected}
                    onChange={() =>
                      onTogglePlayerSelection({
                        playerId: seat.player_id,
                        playerNick: seat.player?.nick,
                        sourceTableId: table.id,
                        fromWaitlist: false,
                        entryId: seat.id,
                      })
                    }
                  />
                  <div className="player-content">
                    <span className="player-name">
                      {(() => {
                        let isTCLabeled = false;
                        try {
                          const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
                          isTCLabeled = tcList.some((entry: any) => entry.playerId === seat.player_id);
                        } catch {}
                        return isTCLabeled ? <span className="player-tc-label" title="Table Change pending">TC</span> : null;
                      })()}
                      <span className="player-name-text">
                        {searchQuery ? (
                          <>
                            {(seat.player?.nick || 'Unknown').split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
                              part.toLowerCase() === searchQuery.toLowerCase() ? (
                                <mark key={i} className="search-highlight">{part}</mark>
                              ) : (
                                <span key={i}>{part}</span>
                              )
                            )}
                          </>
                        ) : (
                          seat.player?.nick || 'Unknown'
                        )}
                      </span>
                      {assignment?.waitlisted && (
                        <span className="assignment-icon" title={`Also waitlisted at Table ${assignment.waitlisted}`}>
                          WL T{assignment.waitlisted}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="player-actions">
                    <Tooltip content="Add to another game type waitlist">
                      <button
                        className="player-wl-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWlGameTypeMenu({ player: seat });
                        }}
                        title="Add to game type waitlist"
                      >
                        WL
                      </button>
                    </Tooltip>
                    <Tooltip content="Table Change - Add to another table's waitlist">
                      <button
                        className="player-table-change"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTcAddAll(false);
                          setTcSameGameOnly(true);
                          setTableChangeMenu({ player: seat, isFromWaitlist: false });
                        }}
                        title="Table Change"
                      >
                        TC
                      </button>
                    </Tooltip>
                    <Tooltip content="Bust out player">
                      <button
                        className="player-quick-bust"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBustOut(seat.id);
                        }}
                        title="Bust out player"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>


      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">
            {contextMenu.player.player?.nick || 'Unknown'}
          </div>
          {!contextMenu.isFromWaitlist && (
            <div className="context-menu-item" onClick={() => {
              handleBustOut(contextMenu.player.id);
              setContextMenu(null);
            }}>
              Bust Out
            </div>
          )}
          {contextMenu.isFromWaitlist && (
            <div className="context-menu-item" onClick={() => {
              handleRemoveWaitlist(contextMenu.player.id);
              setContextMenu(null);
            }}>
              Remove
            </div>
          )}
          {!contextMenu.isFromWaitlist && (
            <div className="context-menu-item" onClick={() => {
              handleMoveToWaitlist(contextMenu.player as TableSeat);
              setContextMenu(null);
            }}>
              Move to Waitlist
            </div>
          )}
          <div className="context-menu-divider"></div>
          <div className="context-menu-section">Table Change (to Waitlist):</div>
          {allTables
            .filter(t => t.id !== table.id && t.status !== 'CLOSED')
            .map(t => (
              <div
                key={t.id}
                className="context-menu-item"
                onClick={() => {
                  handleTableChange(contextMenu.player, t.id, contextMenu.isFromWaitlist);
                  setContextMenu(null);
                }}
              >
                Table {t.table_number} ({t.game_type})
              </div>
            ))
          }
          <div className="context-menu-divider"></div>
          <div className="context-menu-section">Move & Seat:</div>
          {allTables
            .filter(t => t.id !== table.id && t.status !== 'CLOSED')
            .map(t => (
              <div
                key={t.id}
                className="context-menu-item"
                onClick={() => {
                  handleQuickMove(contextMenu.player, t.id, contextMenu.isFromWaitlist);
                  setContextMenu(null);
                }}
              >
                Table {t.table_number} ({t.game_type})
              </div>
            ))
          }
        </div>
      )}

      {tableChangeMenu && (() => {
        const availableTables = allTables.filter(t => t.id !== table.id && t.status !== 'CLOSED');
        const sourceKey = `${table.game_type}||${table.stakes_text}`;

        // Group available tables by game type + stakes
        const tcGroups = new Map<string, { label: string; gameType: string; stakes: string; tables: typeof availableTables; isSameStakes: boolean; isSameGame: boolean }>();
        for (const t of availableTables) {
          const gameType = t.game_type || 'Other';
          const stakes = t.stakes_text || '';
          const key = `${gameType}||${stakes}`;
          if (!tcGroups.has(key)) {
            const label = stakes ? `${gameType} — ${stakes}` : gameType;
            tcGroups.set(key, { label, gameType, stakes, tables: [], isSameStakes: key === sourceKey, isSameGame: gameType === table.game_type });
          }
          tcGroups.get(key)!.tables.push(t);
        }

        // Sort: same game+stakes first, then same game type (different stakes), then others
        const sortedTcGroups = Array.from(tcGroups.values()).sort((a, b) => {
          if (a.isSameStakes && !b.isSameStakes) return -1;
          if (!a.isSameStakes && b.isSameStakes) return 1;
          if (a.isSameGame && !b.isSameGame) return -1;
          if (!a.isSameGame && b.isSameGame) return 1;
          return a.label.localeCompare(b.label);
        });

        const filteredTcGroups = tcSameGameOnly ? sortedTcGroups.filter(g => g.isSameGame) : sortedTcGroups;
        const allVisibleTables = filteredTcGroups.flatMap(g => g.tables);

        return (
          <>
            <div
              className="table-change-backdrop"
              onClick={() => setTableChangeMenu(null)}
            />
            <div
              className="table-change-menu"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="table-change-header">
                <span>Table Change: {tableChangeMenu.player.player?.nick || 'Unknown'}</span>
                <button
                  className="table-change-close"
                  onClick={() => setTableChangeMenu(null)}
                >
                  ×
                </button>
              </div>

              <button
                className="tc-label-only-btn"
                onClick={() => {
                  const playerId = tableChangeMenu.player.player_id;
                  const playerName = tableChangeMenu.player.player?.nick || 'player';
                  try {
                    const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
                    if (!tcList.some((entry: any) => entry.playerId === playerId)) {
                      tcList.push({ playerId, fromTableNumber: table.table_number, timestamp: Date.now() });
                      localStorage.setItem('tc-list', JSON.stringify(tcList));
                    }
                  } catch {}
                  try {
                    const channel = new BroadcastChannel('admin-updates');
                    channel.postMessage({ type: 'player-update', action: 'tc-label', playerId });
                    channel.close();
                  } catch {}
                  localStorage.setItem('player-updated', new Date().toISOString());
                  showToast(`${playerName} labeled as TC`, 'success');
                  setTableChangeMenu(null);
                  loadTableData(true);
                }}
              >
                Label TC Only (No Table Yet)
              </button>

              <div className="tc-options-bar">
                <label className="tc-option-label">
                  <input
                    type="checkbox"
                    checked={tcSameGameOnly}
                    onChange={(e) => setTcSameGameOnly(e.target.checked)}
                  />
                  Same game only
                </label>
                <label className="tc-option-label">
                  <input
                    type="checkbox"
                    checked={tcAddAll}
                    onChange={(e) => setTcAddAll(e.target.checked)}
                  />
                  Add to all
                </label>
              </div>

              {tcAddAll ? (
                <div className="tc-add-all-confirm">
                  <div className="tc-add-all-summary">
                    Add <strong>{tableChangeMenu.player.player?.nick || 'player'}</strong> to waitlist at <strong>{allVisibleTables.length}</strong> table{allVisibleTables.length !== 1 ? 's' : ''}
                    {tcSameGameOnly ? ` (${table.game_type})` : ''}
                  </div>
                  <div className="tc-add-all-list">
                    {allVisibleTables.map(t => (
                      <span key={t.id} className="tc-add-all-tag">Table {t.table_number}</span>
                    ))}
                  </div>
                  <button
                    className="tc-add-all-btn"
                    disabled={allVisibleTables.length === 0}
                    onClick={() => {
                      allVisibleTables.forEach(t => {
                        handleTableChange(tableChangeMenu.player, t.id, tableChangeMenu.isFromWaitlist);
                      });
                      setTableChangeMenu(null);
                    }}
                  >
                    Confirm — Add to {allVisibleTables.length} Table{allVisibleTables.length !== 1 ? 's' : ''}
                  </button>
                </div>
              ) : (
                <>
                  <div className="table-change-subtitle">
                    Add to waitlist at:
                  </div>
                  <div className="table-change-list">
                    {filteredTcGroups.length > 0 ? filteredTcGroups.map(({ label, tables, isSameStakes, isSameGame }) => (
                      <div key={label}>
                        <div className={`tc-group-header${isSameStakes ? ' tc-group-same-stakes' : isSameGame ? ' tc-group-same-game' : ''}`}>
                          {label}{isSameStakes ? ' (Same)' : ''}
                          {tables.length > 1 && (
                            <button
                              className="tc-group-add-all-btn"
                              onClick={() => {
                                tables.forEach(t => {
                                  handleTableChange(tableChangeMenu.player, t.id, tableChangeMenu.isFromWaitlist);
                                });
                                setTableChangeMenu(null);
                              }}
                            >
                              All ({tables.length})
                            </button>
                          )}
                        </div>
                        {tables.map(t => (
                          <div
                            key={t.id}
                            className={`table-change-item${isSameStakes ? ' tc-same-game' : ''}`}
                            onClick={() => {
                              handleTableChange(tableChangeMenu.player, t.id, tableChangeMenu.isFromWaitlist);
                              setTableChangeMenu(null);
                            }}
                          >
                            <div className="table-change-item-main">
                              <strong>Table {t.table_number}</strong>
                            </div>
                            <div className="table-change-item-info">
                              {t.seats_filled || 0}/{t.seats_total || 20} seats
                            </div>
                          </div>
                        ))}
                      </div>
                    )) : (
                      <div className="tc-no-tables">No other {tcSameGameOnly ? table.game_type + ' ' : ''}tables available</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        );
      })()}

      {wlGameTypeMenu && (() => {
        const playerId = wlGameTypeMenu.player.player_id;
        const playerName = wlGameTypeMenu.player.player?.nick || 'Unknown';

        // Group ALL tables by game type + stakes (exclude current table only, not current game type)
        const wlGroups = new Map<string, { gameType: string; stakes: string; tables: typeof allTables; isSameGame: boolean }>();
        for (const t of allTables) {
          if (t.status === 'CLOSED') continue;
          if (t.id === table.id) continue; // Exclude current table only
          const gameType = t.game_type || 'Other';
          const stakes = t.stakes_text || '';
          const key = `${gameType}||${stakes}`;
          const existing = wlGroups.get(key);
          if (existing) {
            existing.tables.push(t);
          } else {
            const isSameGame = gameType === (table.game_type || 'Other');
            wlGroups.set(key, { gameType, stakes, tables: [t], isSameGame });
          }
        }

        // Sort: different game types first (that's the primary WL use case), then same game
        const sortedWlGroups = Array.from(wlGroups.values()).sort((a, b) => {
          if (!a.isSameGame && b.isSameGame) return -1;
          if (a.isSameGame && !b.isSameGame) return 1;
          return a.gameType.localeCompare(b.gameType);
        });

        return (
          <>
            <div className="wl-overlay" onClick={() => setWlGameTypeMenu(null)} />
            <div className="wl-game-type-popup">
              <div className="wl-popup-header">
                <strong>Add {playerName} to waitlist</strong>
                <button className="wl-popup-close" onClick={() => setWlGameTypeMenu(null)}>×</button>
              </div>
              <div className="wl-popup-subtitle">No TC label — player stays at current table</div>
              <div className="wl-popup-body">
                {sortedWlGroups.length === 0 ? (
                  <div className="wl-popup-empty">No other tables available</div>
                ) : (
                  sortedWlGroups.map(group => {
                    const label = group.stakes ? `${group.gameType} — ${group.stakes}` : group.gameType;
                    return (
                      <div key={`${group.gameType}||${group.stakes}`}>
                        <div className={`wl-group-header${group.isSameGame ? ' wl-group-same-game' : ''}`}>
                          <span>{label}{group.isSameGame ? ' (Same Game)' : ''}</span>
                          {group.tables.length > 1 && (
                            <button
                              className="wl-group-add-all-btn"
                              onClick={async () => {
                                for (const t of group.tables) {
                                  await handleWaitlistAdd(wlGameTypeMenu.player, t.id);
                                }
                                setWlGameTypeMenu(null);
                              }}
                            >
                              All ({group.tables.length})
                            </button>
                          )}
                        </div>
                        {group.tables.map(t => (
                          <button
                            key={t.id}
                            className="wl-game-type-item"
                            onClick={async () => {
                              await handleWaitlistAdd(wlGameTypeMenu.player, t.id);
                              setWlGameTypeMenu(null);
                            }}
                          >
                            <span className="wl-game-name">Table {t.table_number}</span>
                            <span className="wl-game-info">{t.seats_filled || 0}/{t.seats_total || 20} seats</span>
                          </button>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        );
      })()}

      {doorFeeModal && (
        <DoorFeeModal
          playerName={doorFeeModal.playerName}
          defaultAmount={doorFeeModal.defaultAmount}
          tables={allTables.filter(t => t.status !== 'CLOSED')}
          showTableSelection={doorFeeModal.player.called_in === true}
          defaultTableId={table.id}
          onConfirm={async (amount, selectedTableId, isPreviousPlayer) => {
            const playerId = doorFeeModal.player.player_id;
            const playerData = doorFeeModal.player.player;
            const targetTableId = selectedTableId || table.id;
            
            // ============================================================================
            // CLIENT-SIDE OPTIMISTIC UPDATE - Player appears IMMEDIATELY (no server wait)
            // ============================================================================
            // Update UI FIRST, then sync with server in background
            // This ensures instant feedback without waiting for server response
            
            // Step 1: Remove from waitlist IMMEDIATELY (only if staying at same table)
            if (targetTableId === table.id) {
              setWaitlistPlayers(prev => prev.filter(w => w.id !== doorFeeModal.player.id && w.player_id !== playerId));
            }
            
            // Step 2: Create optimistic seat entry
            // Use player_id + timestamp + random to ensure unique ID
            const uniqueId = `temp-seat-${playerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const optimisticSeat: TableSeat = {
              id: uniqueId,
              club_day_id: clubDayId,
              table_id: targetTableId,
              player_id: playerId,
              player: playerData,
              seated_at: new Date().toISOString(),
              left_at: undefined,
              created_at: new Date().toISOString(),
            };
            
            // Step 3: Add to optimistic players ref FIRST (persists across refreshes)
            optimisticPlayersRef.current.seated.push(optimisticSeat);
            optimisticUpdatesRef.current.add(playerId);
            
            // Step 4: Update state IMMEDIATELY - player appears RIGHT NOW (only if staying at same table)
            if (targetTableId === table.id) {
              setSeatedPlayers(prev => {
                const alreadySeated = prev.some(s => s.player_id === playerId);
                if (alreadySeated) {
                  log('⚠️ Player already in seated list, skipping optimistic add');
                  return prev;
                }
                log('✅ CLIENT-SIDE: Player added to seated list IMMEDIATELY:', optimisticSeat.player?.nick || playerId);
                return [...prev, optimisticSeat];
              });
            }
            
            // Step 5: Check if player is a TC (table change) before cleaning up
            let wasTC = false;
            try {
              const tcList = JSON.parse(localStorage.getItem('tc-list') || '[]');
              wasTC = tcList.some((entry: any) => entry.playerId === playerId);
              const cleaned = tcList.filter((entry: any) => entry.playerId !== playerId);
              localStorage.setItem('tc-list', JSON.stringify(cleaned));
            } catch {}

            // Step 5b: Close modal immediately
            setDoorFeeModal(null);
            
            // Step 6: Broadcast to other components (for multi-tab/multi-component sync)
            // BUT: Don't set localStorage yet - it triggers polling refresh too soon
            try {
              const channel = new BroadcastChannel('admin-updates');
              channel.postMessage({
                type: 'player-update',
                action: doorFeeModal.player.called_in ? 'seat-called-in' : 'seat-next',
                tableId: targetTableId,
                playerId: playerId,
                playerData: playerData
              });
              channel.close();
            } catch (error) {
              logWarn('Failed to broadcast seat update:', error);
            }
            // Delay localStorage update to prevent premature refresh
            // This gives the optimistic update time to be visible before any refresh
            
            // Step 7: Show success message immediately
            // Toast removed per user request
            
            // Step 8: Call API in background (non-blocking) - player already visible
            // Track as in-flight move
            if (!inFlightMovesRef.current.has(playerId)) {
              inFlightMovesRef.current.add(playerId);
            }
            
            // Call API in background (non-blocking) - player already visible
            // Previous player: just seat directly, skip accounting
            const seatPromise = isPreviousPlayer
              ? seatPlayer(targetTableId, playerId, clubDayId)
              : seatCalledInPlayer(targetTableId, playerId, clubDayId, amount, adminUser);
            seatPromise
              .then(async () => {
                log('✅ Server confirmed seat operation');

                // Note: Player remains on other game type waitlists (multi-game-type support)
                // If TC player, also remove from previous table's seat
                if (wasTC) {
                  try {
                    const allSeats = await getSeatedPlayersForPlayer(playerId, clubDayId);
                    const oldSeats = allSeats.filter(s => s.table_id !== targetTableId);
                    for (const oldSeat of oldSeats) {
                      await removePlayerFromSeat(oldSeat.id, oldSeat.table_id, adminUser);
                      log(`Removed TC player from old seat at table ${oldSeat.table_id}`);
                    }
                  } catch (err) {
                    logWarn('Failed to remove TC player from previous table:', err);
                  }
                }

                // NOW set localStorage and refresh - server has processed
                localStorage.setItem('player-updated', new Date().toISOString());
                // Refresh to replace optimistic entry with real server data
                setTimeout(() => {
                  loadTableData(true);
                  inFlightMovesRef.current.delete(playerId);
                  // Also trigger parent refresh for AdminPage state sync
                  onRefresh();
                }, 300);
              })
              .catch((err: any) => {
                logError('❌ Server seat operation failed:', err);
                // Rollback optimistic update on error (only if was at this table)
                if (targetTableId === table.id) {
                  setSeatedPlayers(prev => prev.filter(s => s.id !== optimisticSeat.id && s.player_id !== playerId));
                }
                optimisticPlayersRef.current.seated = optimisticPlayersRef.current.seated.filter(s => s.player_id !== playerId);
                optimisticUpdatesRef.current.delete(playerId);
                inFlightMovesRef.current.delete(playerId);
                saveOptimisticPlayers(); // Update localStorage
                showToast(err.message || 'Failed to seat player - changes reverted', 'error');
                // Refresh to sync state
                localStorage.setItem('player-updated', new Date().toISOString());
                setTimeout(() => onRefresh(), 300);
              });
            
            // Don't call onRefresh() immediately - it would fetch server data too soon
            // The optimistic update is already visible, we'll refresh after server confirms
          }}
          onClose={() => {
            // Clear any in-flight move tracking when modal closes
            if (doorFeeModal) {
              inFlightMovesRef.current.delete(doorFeeModal.player.player_id);
            }
            setDoorFeeModal(null);
          }}
        />
      )}
    </div>
  );
}

// Memoize TableCard to prevent unnecessary re-renders
// Only re-render if props actually change
export default memo(TableCard, (prevProps, nextProps) => {
  // Custom comparison function for better performance
  return (
    prevProps.table.id === nextProps.table.id &&
    prevProps.table.status === nextProps.table.status &&
    prevProps.table.show_on_tv === nextProps.table.show_on_tv &&
    prevProps.table.bomb_pot_count === nextProps.table.bomb_pot_count &&
    prevProps.clubDayId === nextProps.clubDayId &&
    prevProps.searchQuery === nextProps.searchQuery &&
    Object.keys(prevProps.selectedPlayers).length === Object.keys(nextProps.selectedPlayers).length &&
    prevProps.allTables.length === nextProps.allTables.length
  );
});
