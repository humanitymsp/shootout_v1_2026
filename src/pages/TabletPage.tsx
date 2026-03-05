import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { format } from 'date-fns';
import { getActiveClubDay, getTablesForClubDay } from '../lib/api';
import { seatPlayer, removePlayerFromSeat, addPlayerToWaitlist, removePlayerFromWaitlist, reorderWaitlistPosition, removePlayerFromAllWaitlists, getCheckInForPlayer } from '../lib/api';
import { getTableCounts } from '../lib/tableCounts';
import { initializeLocalPlayers, startPlayerSyncPolling } from '../lib/localStoragePlayers';
import { showToast } from '../components/Toast';
import { logError, log } from '../lib/logger';
import type { PokerTable, TableSeat, TableWaitlist, ClubDay } from '../types';
import Logo from '../components/Logo';
import '../components/TabletManagementPage.css';

export default function TabletPage() {
  const navigate = useNavigate();
  const [clubDay, setClubDay] = useState<ClubDay | null>(null);
  const [tables, setTables] = useState<PokerTable[]>([]);
  const [adminUser, setAdminUser] = useState<string>('admin');
  const [selectedPlayer, setSelectedPlayer] = useState<{ player: TableSeat | TableWaitlist; sourceTableId: string; isFromWaitlist: boolean } | null>(null);
  const [tableData, setTableData] = useState<Map<string, { seated: TableSeat[]; waitlist: TableWaitlist[] }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [movingPlayer, setMovingPlayer] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [tcPlayer, setTcPlayer] = useState<{ player: TableSeat | TableWaitlist; playerName: string; sourceTableId: string } | null>(null);
  const [movePlayer, setMovePlayer] = useState<{ player: TableSeat | TableWaitlist; playerName: string; sourceTableId: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [gridColumns, setGridColumns] = useState(2);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'busy' | 'full'>('all');
  const [lastBustAction, setLastBustAction] = useState<{ seat: TableSeat; tableId: string; tableNumber: number } | null>(null);
  const [undoTimeout, setUndoTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredPlayer, setHoveredPlayer] = useState<string | null>(null);
  const [swipeStart, setSwipeStart] = useState<{ x: number; y: number; playerId: string; timestamp: number } | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTableIdsRef = useRef<string>('');
  const isLoadingRef = useRef(false);
  const tablesRef = useRef<PokerTable[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  // Check for authenticated user (optional - tablet can work without auth)
  useEffect(() => {
    const checkUser = async () => {
      try {
        const currentUser = await getCurrentUser();
        const user = currentUser.signInDetails?.loginId || currentUser.username || 'admin';
        setAdminUser(user);
      } catch (err: any) {
        // Not authenticated - use default admin user
        setAdminUser('admin');
      }
    };
    checkUser();
  }, []);

  // Load club day and tables
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        initializeLocalPlayers();
        
        const activeDay = await getActiveClubDay();
        if (!activeDay) {
          setLoading(false);
          return;
        }
        
        setClubDay(activeDay);
        const tablesData = await getTablesForClubDay(activeDay.id);
        setTables(tablesData);
        tablesRef.current = tablesData;
        setLoading(false);
      } catch (error) {
        logError('Error loading tablet page data:', error);
        setLoading(false);
      }
    };
    
    loadInitialData();
  }, []);

  // Initialize localStorage players and start syncing from admin
  useEffect(() => {
    if (!clubDay) return;
    
    initializeLocalPlayers();
    
    // Start syncing players from admin device
    const stopPlayerSync = startPlayerSyncPolling(clubDay.id, (players) => {
      log(`📡 Tablet: Synced ${players.length} players from admin`);
    }, 3000); // Poll every 3 seconds
    
    return () => {
      stopPlayerSync();
    };
  }, [clubDay]);

  // Update ref when tables change
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // Create stable table IDs string for comparison
  const tableIdsString = useMemo(() => {
    return tables.filter(t => t.status !== 'CLOSED').map(t => t.id).sort().join(',');
  }, [tables]);

  // Load function - uses tables from ref to avoid dependency issues
  const loadAllTableData = useCallback(async () => {
    if (!clubDay) return;
    
    // Prevent concurrent loads
    if (isLoadingRef.current) {
      return;
    }
    
    isLoadingRef.current = true;
    setLoading(true);
    const data = new Map<string, { seated: TableSeat[]; waitlist: TableWaitlist[] }>();
    
    // Get current tables from ref
    const currentTables = tablesRef.current.filter(t => t.status !== 'CLOSED');
    for (const table of currentTables) {
      try {
        // Use centralized counting function - SINGLE SOURCE OF TRUTH
        // CRITICAL: Pass clubDayId to prevent counting players from old club days
        const counts = await getTableCounts(table.id, clubDay.id);
        data.set(table.id, { 
          seated: counts.seatedPlayers, 
          waitlist: counts.waitlistPlayers 
        });
      } catch (error) {
        logError(`Error loading data for table ${table.id}:`, error);
        data.set(table.id, { seated: [], waitlist: [] });
      }
    }
    
    setTableData(data);
    setLoading(false);
    isLoadingRef.current = false;
  }, [clubDay]);

  // Load player data for all tables - only when table structure actually changes
  useEffect(() => {
    // Only reload if table IDs actually changed (not just array reference)
    if (tableIdsString !== lastTableIdsRef.current && clubDay) {
      lastTableIdsRef.current = tableIdsString;
      loadAllTableData();
    }
  }, [tableIdsString, clubDay, loadAllTableData]);

  // Listen for real-time updates via broadcast channels
  useEffect(() => {
    const handleBroadcastMessage = (event: MessageEvent) => {
      if (event.data?.type === 'player-update' || event.data?.type === 'table-update') {
        // Debounce rapid updates
        setTimeout(() => {
          if (!isLoadingRef.current) {
            loadAllTableData();
          }
        }, 500);
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'player-updated' || e.key === 'table-updated') {
        setTimeout(() => {
          if (!isLoadingRef.current) {
            loadAllTableData();
          }
        }, 500);
      }
    };

    let broadcastChannel: BroadcastChannel | null = null;
    try {
      broadcastChannel = new BroadcastChannel('admin-updates');
      broadcastChannel.addEventListener('message', handleBroadcastMessage);
    } catch (error) {
      // BroadcastChannel not supported
    }

    window.addEventListener('storage', handleStorageEvent);

    return () => {
      if (broadcastChannel) {
        broadcastChannel.removeEventListener('message', handleBroadcastMessage);
        broadcastChannel.close();
      }
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [loadAllTableData]);

  // Poll table data every 5s for cross-device sync (BroadcastChannel only works same-device)
  useEffect(() => {
    if (!clubDay) return;
    const pollInterval = setInterval(() => {
      if (document.hidden) return;
      // Refresh tables list
      getTablesForClubDay(clubDay.id)
        .then(fetched => setTables(fetched))
        .catch(() => {});
      // Refresh seat/waitlist data
      if (!isLoadingRef.current) {
        loadAllTableData();
      }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [clubDay, loadAllTableData]);

  // Broadcast update to admin page after tablet makes changes
  const broadcastUpdate = useCallback((action: string, tableId?: string, playerId?: string) => {
    try {
      const channel = new BroadcastChannel('admin-updates');
      channel.postMessage({ type: 'player-update', action, tableId, playerId });
      channel.close();
    } catch {
      // BroadcastChannel not supported
    }
    // Also trigger storage event for cross-tab
    localStorage.setItem('player-updated', Date.now().toString());
  }, []);

  // Lock to portrait orientation and request fullscreen on Android tablet
  useEffect(() => {
    // Lock orientation to portrait
    try {
      const orientation = (screen as any).orientation || (screen as any).mozOrientation || (screen as any).msOrientation;
      if (orientation && orientation.lock) {
        orientation.lock('portrait').catch(() => {
          // Orientation lock not supported or denied — ignore silently
        });
      }
    } catch {
      // Not supported
    }

    // Prevent pinch-zoom and double-tap zoom on the document level
    const preventZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };
    const preventDoubleTapZoom = (() => {
      let lastTap = 0;
      return (e: TouchEvent) => {
        const now = Date.now();
        if (now - lastTap < 300) {
          e.preventDefault();
        }
        lastTap = now;
      };
    })();

    document.addEventListener('touchstart', preventZoom, { passive: false });
    document.addEventListener('touchstart', preventDoubleTapZoom, { passive: false });

    return () => {
      document.removeEventListener('touchstart', preventZoom);
      document.removeEventListener('touchstart', preventDoubleTapZoom);
      // Release orientation lock on unmount
      try {
        const orientation = (screen as any).orientation;
        if (orientation && orientation.unlock) {
          orientation.unlock();
        }
      } catch {
        // Not supported
      }
    };
  }, []);

  // Update clock every second
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(clockInterval);
  }, []);

  // Detect grid columns
  useEffect(() => {
    const updateGridColumns = () => {
      if (!gridRef.current) return;
      
      const grid = gridRef.current;
      const computedStyle = window.getComputedStyle(grid);
      const gridTemplateColumns = computedStyle.gridTemplateColumns;
      
      const columns = gridTemplateColumns.split(' ').filter(col => col !== '').length;
      if (columns > 0) {
        setGridColumns(columns);
      }
    };

    updateGridColumns();
    window.addEventListener('resize', updateGridColumns);
    return () => window.removeEventListener('resize', updateGridColumns);
  }, []);

  // Detect scrolling to prevent swipe actions during scroll
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    };

    const container = document.querySelector('.tablet-management-page');
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      container.addEventListener('touchmove', handleScroll, { passive: true });
      return () => {
        container.removeEventListener('scroll', handleScroll);
        container.removeEventListener('touchmove', handleScroll);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    }
  }, []);

  const handlePlayerClick = (player: TableSeat | TableWaitlist, sourceTableId: string, isFromWaitlist: boolean) => {
    if (selectedPlayer && selectedPlayer.player.player_id === player.player_id && selectedPlayer.sourceTableId === sourceTableId) {
      // Deselect if clicking the same player
      setSelectedPlayer(null);
    } else {
      setSelectedPlayer({ player, sourceTableId, isFromWaitlist });
    }
  };

  const handleQuickBust = (seat: TableSeat, tableId: string, tableNumber: number, e: React.MouseEvent) => {
    e.stopPropagation();
    handleBustPlayer(seat, tableId, tableNumber, true);
  };

  const handleQuickTC = (player: TableSeat | TableWaitlist, sourceTableId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    handleTCPrompt(player, sourceTableId);
  };

  const handleQuickRemove = (wl: TableWaitlist, tableId: string, tableNumber: number, e: React.MouseEvent) => {
    e.stopPropagation();
    handleRemoveFromWaitlist(wl, tableId, tableNumber);
  };

  const handleQuickSeat = async (wl: TableWaitlist, tableId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!clubDay) return;
    
    const playerName = wl.player?.nick || wl.player?.name || 'Player';
    
    const data = tableData.get(tableId) || { seated: [], waitlist: [] };
    const isFull = data.seated.length >= (tables.find(t => t.id === tableId)?.seats_total || 9);
    
    if (isFull) {
      showToast('Table is full', 'error');
      return;
    }

    // Check if player is bought in (checked in) before allowing seating
    setActionInProgress(wl.id);
    try {
      const checkIn = await getCheckInForPlayer(wl.player_id, clubDay.id);
      if (!checkIn) {
        showToast(`${playerName} has not been checked in yet. Check in on the admin page first.`, 'error');
        setActionInProgress(null);
        return;
      }

      await removePlayerFromWaitlist(wl.id, adminUser);
      await seatPlayer(tableId, wl.player_id, clubDay.id);
      
      showToast(`${playerName} seated`, 'success');
      setSelectedPlayer(null);
      broadcastUpdate('seat', tableId, wl.player_id);
      loadAllTableData();
    } catch (error: any) {
      logError('Error seating from waitlist:', error);
      showToast(error.message || 'Failed to seat player', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  // Swipe gesture handlers - only trigger on intentional horizontal swipes, not during scrolling
  const handleTouchStart = (e: React.TouchEvent, playerId: string) => {
    // Don't interfere with scrolling - let the browser handle it naturally
    // Only record touch start if not currently scrolling
    if (!isScrolling) {
      const touch = e.touches[0];
      setSwipeStart({ x: touch.clientX, y: touch.clientY, playerId, timestamp: Date.now() });
    }
  };

  const handleTouchCancel = () => {
    // Clear swipe start if touch is cancelled (e.g., during scrolling)
    setSwipeStart(null);
  };

  const handleTouchEnd = (e: React.TouchEvent, player: TableSeat | TableWaitlist, sourceTableId: string, isFromWaitlist: boolean, tableNumber: number) => {
    if (!swipeStart || swipeStart.playerId !== player.player_id) {
      setSwipeStart(null);
      return;
    }

    // Don't trigger swipe if user is scrolling
    if (isScrolling) {
      setSwipeStart(null);
      return;
    }

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Only trigger swipe actions if:
    // 1. Horizontal movement is significant (at least 120px) - very intentional
    // 2. Horizontal movement is at least 4x the vertical movement (clearly horizontal, not scrolling)
    // 3. Movement happened quickly (less than 350ms) - prevents accidental triggers during slow scrolls
    // 4. Vertical movement is minimal (less than 25px) - ensures it's not a scroll gesture
    const timeDiff = Date.now() - swipeStart.timestamp;
    const isHorizontalSwipe = absX > 120 && absX > absY * 4 && timeDiff < 350 && absY < 25;

    if (isHorizontalSwipe) {
      // Only prevent default for very clear intentional swipes
      e.preventDefault();
      e.stopPropagation();
      if (deltaX > 0 && !isFromWaitlist) {
        // Swipe right = Quick bust
        const seat = player as TableSeat;
        handleBustPlayer(seat, sourceTableId, tableNumber, true);
      } else if (deltaX < 0) {
        // Swipe left = Quick TC
        handleTCPrompt(player, sourceTableId);
      }
    }
    
    setSwipeStart(null);
  };

  const handleBustPlayer = async (seat: TableSeat, tableId: string, tableNumber: number, skipConfirm = false) => {
    const playerName = seat.player?.nick || seat.player?.name || 'Unknown';
    if (!skipConfirm) {
      const confirmed = window.confirm(`Bust out ${playerName}?`);
      if (!confirmed) return;
    }

    setActionInProgress(seat.id);
    try {
      await removePlayerFromSeat(seat.id, tableId, adminUser);
      
      // Remove busted player from all waitlists
      if (seat.player_id && clubDay) {
        try {
          const removedCount = await removePlayerFromAllWaitlists(seat.player_id, clubDay.id);
          if (removedCount > 0) {
            log(`Removed ${playerName} from ${removedCount} waitlist(s) after bust out`);
          }
        } catch (error) {
          logError('Failed to remove busted player from waitlists:', error);
        }
      }
      
      // Store bust out info for undo (5 seconds)
      setLastBustAction({ seat, tableId, tableNumber });
      
      // Clear any existing undo timeout
      if (undoTimeout) {
        clearTimeout(undoTimeout);
      }
      
      // Set timeout to clear undo option after 5 seconds
      const timeout = setTimeout(() => {
        setLastBustAction(null);
      }, 5000);
      setUndoTimeout(timeout);
      
      // Store bust out info for re-seating (last 30 minutes)
      try {
        const bustOutData = {
          playerId: seat.player_id,
          playerNick: playerName,
          tableId: tableId,
          tableNumber: tableNumber,
          bustedOutAt: Date.now(),
        };
        const recentBustOuts = JSON.parse(localStorage.getItem('recent-bust-outs') || '[]');
        recentBustOuts.push(bustOutData);
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
        const filtered = recentBustOuts.filter((b: any) => b.bustedOutAt > thirtyMinutesAgo);
        localStorage.setItem('recent-bust-outs', JSON.stringify(filtered));
      } catch (error) {
        logError('Failed to store bust out info:', error);
      }
      
      broadcastUpdate('remove', tableId, seat.player_id);
      
      showToast(`${playerName} busted out`, 'success');
      setSelectedPlayer(null);
      loadAllTableData();
    } catch (error: any) {
      logError('Error busting player:', error);
      showToast(error.message || 'Failed to bust player', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUndoBust = async () => {
    if (!lastBustAction || !clubDay) return;
    
    const { seat, tableId } = lastBustAction;
    setActionInProgress(seat.id);
    try {
      await seatPlayer(tableId, seat.player_id, clubDay.id);
      showToast(`${seat.player?.nick || seat.player?.name || 'Player'} re-seated`, 'success');
      setLastBustAction(null);
      if (undoTimeout) {
        clearTimeout(undoTimeout);
        setUndoTimeout(null);
      }
      broadcastUpdate('seat', tableId, seat.player_id);
      loadAllTableData();
    } catch (error: any) {
      logError('Error undoing bust:', error);
      showToast(error.message || 'Failed to undo bust', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRemoveFromWaitlist = async (wl: TableWaitlist, tableId: string, tableNumber: number) => {
    const playerName = wl.player?.nick || wl.player?.name || 'Unknown';
    const confirmed = window.confirm(`Remove ${playerName} from Table ${tableNumber} waitlist?`);
    if (!confirmed) return;

    setActionInProgress(wl.id);
    try {
      await removePlayerFromWaitlist(wl.id, adminUser);
      
      broadcastUpdate('remove-waitlist', tableId, wl.player_id);
      
      showToast(`${playerName} removed from waitlist`, 'success');
      setSelectedPlayer(null);
      loadAllTableData();
    } catch (error: any) {
      logError('Error removing from waitlist:', error);
      showToast(error.message || 'Failed to remove from waitlist', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTCPrompt = (player: TableSeat | TableWaitlist, sourceTableId: string) => {
    const playerName = player.player?.nick || player.player?.name || 'Unknown';
    setTcPlayer({ player, playerName, sourceTableId });
  };

  const handleMovePrompt = (player: TableSeat | TableWaitlist, sourceTableId: string) => {
    const playerName = player.player?.nick || player.player?.name || 'Unknown';
    setMovePlayer({ player, playerName, sourceTableId });
  };

  const handleMoveToTable = async (targetTableId: string, targetType: 'seat' | 'waitlist', targetTableNumber: number) => {
    if (!movePlayer || !clubDay) return;

    const { player, playerName, sourceTableId } = movePlayer;

    if (sourceTableId === targetTableId) {
      showToast('Player is already at this table', 'error');
      return;
    }

    const playerId = 'id' in player ? player.id : '';
    setActionInProgress(playerId);
    try {
      // Remove from current position
      if ('table_id' in player) {
        // It's a seated player
        await removePlayerFromSeat(playerId, sourceTableId, adminUser);
      } else {
        // It's a waitlisted player
        await removePlayerFromWaitlist(playerId, adminUser);
      }

      // Add to target table
      if (targetType === 'seat') {
        await seatPlayer(targetTableId, player.player_id, clubDay.id);
        showToast(`${playerName} moved to Table ${targetTableNumber}`, 'success');
      } else {
        await addPlayerToWaitlist(targetTableId, player.player_id, clubDay.id, adminUser);
        showToast(`${playerName} moved to Table ${targetTableNumber} waitlist`, 'success');
      }
      
      broadcastUpdate('move', targetTableId, player.player_id);
      setMovePlayer(null);
      setSelectedPlayer(null);
      loadAllTableData();
    } catch (error: any) {
      logError('Error moving player:', error);
      showToast(error.message || 'Failed to move player', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTCToWaitlist = async (targetTableId: string, targetTableNumber: number) => {
    if (!tcPlayer || !clubDay) return;

    const { player, playerName, sourceTableId } = tcPlayer;

    if (sourceTableId === targetTableId) {
      showToast('Player is already at this table', 'error');
      return;
    }

    setActionInProgress(player.id);
    try {
      // Add player to waitlist of target table (they stay seated at current table)
      await addPlayerToWaitlist(targetTableId, player.player_id, clubDay.id, adminUser);
      
      broadcastUpdate('tc-waitlist', targetTableId, player.player_id);
      showToast(`${playerName} added to Table ${targetTableNumber} waitlist`, 'success');
      setTcPlayer(null);
      setSelectedPlayer(null);
      loadAllTableData();
    } catch (error: any) {
      logError('Error requesting table change:', error);
      showToast(error.message || 'Failed to request table change', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMovePlayer = async (targetTableId: string, targetType: 'seat' | 'waitlist') => {
    if (!selectedPlayer || !clubDay) return;

    const { player, sourceTableId, isFromWaitlist } = selectedPlayer;
    const playerId = player.player_id;

    // Allow same-table moves if moving from waitlist to seat
    const isSameTableMove = sourceTableId === targetTableId;
    if (isSameTableMove && !(isFromWaitlist && targetType === 'seat')) {
      if (isFromWaitlist && targetType === 'waitlist') {
        showToast('Player is already on this waitlist', 'error');
        return;
      }
      if (!isFromWaitlist && targetType === 'seat') {
        showToast('Player is already seated at this table', 'error');
        return;
      }
    }

    setMovingPlayer(playerId);
    try {
      if (isFromWaitlist) {
        await removePlayerFromWaitlist(player.id, adminUser);
      } else {
        await removePlayerFromSeat(player.id, sourceTableId, adminUser);
      }

      if (targetType === 'seat') {
        await seatPlayer(targetTableId, playerId, clubDay.id);
      } else {
        await addPlayerToWaitlist(targetTableId, playerId, clubDay.id, adminUser);
      }

      broadcastUpdate('move', targetTableId, playerId);
      showToast('Player moved successfully', 'success');
      setSelectedPlayer(null);
      loadAllTableData();
    } catch (error: any) {
      logError('Error moving player:', error);
      showToast(error.message || 'Failed to move player', 'error');
    } finally {
      setMovingPlayer(null);
    }
  };


  // Filter and search logic - MUST be before early returns (Rules of Hooks)
  const activeTables = tables.filter(t => t.status !== 'CLOSED');
  
  const filteredTables = useMemo(() => {
    let filtered = activeTables;
    
    // Filter by status
    if (filterStatus !== 'all') {
      filtered = filtered.filter(table => {
        const data = tableData.get(table.id) || { seated: [], waitlist: [] };
        const seatsFilled = data.seated.length;
        const totalSeats = table.seats_total || 9;
        const filledPercent = (seatsFilled / totalSeats) * 100;
        
        if (filterStatus === 'open') return filledPercent < 70;
        if (filterStatus === 'busy') return filledPercent >= 70 && filledPercent < 90;
        if (filterStatus === 'full') return filledPercent >= 90;
        return true;
      });
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(table => {
        const data = tableData.get(table.id) || { seated: [], waitlist: [] };
        const allPlayers = [...data.seated, ...data.waitlist];
        return allPlayers.some(p => {
          const name = p.player?.nick || p.player?.name || '';
          return name.toLowerCase().includes(query);
        }) || table.table_number.toString().includes(query);
      });
    }
    
    // Sort by total players (seated + waitlist) - largest first
    filtered.sort((a, b) => {
      const dataA = tableData.get(a.id) || { seated: [], waitlist: [] };
      const dataB = tableData.get(b.id) || { seated: [], waitlist: [] };
      const totalA = dataA.seated.length + dataA.waitlist.length;
      const totalB = dataB.seated.length + dataB.waitlist.length;
      
      // Sort by total players descending (most players first)
      if (totalB !== totalA) {
        return totalB - totalA;
      }
      
      // If same number of players, sort by table number ascending
      return a.table_number - b.table_number;
    });
    
    return filtered;
  }, [activeTables, tableData, filterStatus, searchQuery]);
  
  const dateTimeStr = format(currentTime, 'EEE, MMM d • h:mm a');
  const placeholdersNeeded = gridColumns - (filteredTables.length % gridColumns || gridColumns);
  
  // Get table status for styling
  const getTableStatus = (table: PokerTable) => {
    const data = tableData.get(table.id) || { seated: [], waitlist: [] };
    const seatsFilled = data.seated.length;
    const totalSeats = table.seats_total || 9;
    const filledPercent = (seatsFilled / totalSeats) * 100;
    
    if (filledPercent >= 90) return 'full';
    if (filledPercent >= 70) return 'busy';
    return 'open';
  };

  if (loading && !clubDay) {
    return (
      <div className="tablet-management-page">
        <div className="tablet-loading">
          <div className="tablet-spinner"></div>
          <h3>Loading...</h3>
        </div>
      </div>
    );
  }

  if (!clubDay) {
    return (
      <div className="tablet-management-page">
        <div className="tablet-loading">
          <h3>No active club day</h3>
          <button onClick={() => navigate('/admin')} className="tablet-refresh-btn">
            Go to Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tablet-management-page">
      <div className="tablet-logo-section">
        <Logo />
      </div>
      <div className="tablet-header">
        <div className="tablet-header-left">
          <div className="tablet-date-time">
            {dateTimeStr}
          </div>
        </div>
        <div className="tablet-header-right">
          <div className="tablet-header-actions">
            <button 
              className="tablet-refresh-btn" 
              onClick={loadAllTableData}
              disabled={isLoadingRef.current}
            >
              🔄 Refresh
            </button>
            <button className="tablet-close-btn" onClick={() => navigate('/admin')}>
              ← Back to Admin
            </button>
          </div>
        </div>
      </div>

      {/* TC (Table Change) Modal */}
      {tcPlayer && (() => {
        const sourceTable = activeTables.find(t => t.id === tcPlayer.sourceTableId);
        const sourceKey = sourceTable ? `${sourceTable.game_type}||${sourceTable.stakes_text}` : '';
        const availableTables = activeTables.filter(t => t.id !== tcPlayer.sourceTableId);

        // Group available tables by game type + stakes
        const groups = new Map<string, { label: string; gameType: string; stakes: string; tables: PokerTable[]; isSame: boolean }>();
        for (const t of availableTables) {
          const gameType = t.game_type || 'Other';
          const stakes = t.stakes_text || '';
          const key = `${gameType}||${stakes}`;
          if (!groups.has(key)) {
            const label = stakes ? `${gameType} — ${stakes}` : gameType;
            groups.set(key, { label, gameType, stakes, tables: [], isSame: key === sourceKey });
          }
          groups.get(key)!.tables.push(t);
        }

        // Sort: same game+stakes first, then same game type, then others
        const sortedGroups = Array.from(groups.values()).sort((a, b) => {
          if (a.isSame && !b.isSame) return -1;
          if (!a.isSame && b.isSame) return 1;
          if (a.gameType === sourceTable?.game_type && b.gameType !== sourceTable?.game_type) return -1;
          if (a.gameType !== sourceTable?.game_type && b.gameType === sourceTable?.game_type) return 1;
          return a.label.localeCompare(b.label);
        });

        return (
          <div className="tablet-tc-modal-overlay" onClick={() => setTcPlayer(null)}>
            <div className="tablet-tc-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tablet-tc-modal-header">
                <h3>TC: {tcPlayer.playerName}</h3>
                <button className="tablet-tc-modal-close" onClick={() => setTcPlayer(null)}>✕</button>
              </div>
              <div className="tablet-tc-modal-content">
                <p>Add to waitlist (player stays at current table):</p>

                {sortedGroups.map(({ label, tables, isSame }) => (
                  <div key={label} className="tablet-tc-game-group">
                    <div className="tablet-tc-group-header">
                      <span className={isSame ? 'tablet-tc-same-label' : ''}>{label}{isSame ? ' (Same)' : ''}</span>
                      <button
                        className="tablet-tc-add-all-btn"
                        disabled={actionInProgress !== null}
                        onClick={async () => {
                          for (const t of tables) {
                            await handleTCToWaitlist(t.id, t.table_number);
                          }
                        }}
                      >
                        Add to All ({tables.length})
                      </button>
                    </div>
                    <div className="tablet-tc-table-grid">
                      {tables.map((t) => (
                        <button
                          key={t.id}
                          className={`tablet-tc-table-btn${isSame ? ' tablet-tc-same-game' : ''}`}
                          onClick={() => handleTCToWaitlist(t.id, t.table_number)}
                          disabled={actionInProgress !== null}
                        >
                          Table {t.table_number}
                          <span className="tablet-tc-table-info">
                            {t.seats_total ? `${(tableData.get(t.id)?.seated.length || 0)}/${t.seats_total}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {sortedGroups.length === 0 && (
                  <div className="tablet-tc-empty">No other tables available</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Move Player Modal */}
      {movePlayer && (
        <div className="tablet-tc-modal-overlay" onClick={() => setMovePlayer(null)}>
          <div className="tablet-tc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tablet-tc-modal-header">
              <h3>Move: {movePlayer.playerName}</h3>
              <button className="tablet-tc-modal-close" onClick={() => setMovePlayer(null)}>✕</button>
            </div>
            <div className="tablet-tc-modal-content">
              <p>Move player to another table:</p>
              <div className="tablet-move-modal-grid">
                <div className="tablet-move-column">
                  <h4 className="tablet-move-column-title">Move to Table</h4>
                  <div className="tablet-move-table-list">
                    {activeTables
                      .filter(table => {
                        const data = tableData.get(table.id) || { seated: [], waitlist: [] };
                        const isFull = data.seated.length >= (table.seats_total || 9);
                        return table.id !== movePlayer.sourceTableId && !isFull;
                      })
                      .map((table) => (
                        <button
                          key={table.id}
                          className="tablet-tc-table-btn"
                          onClick={() => handleMoveToTable(table.id, 'seat', table.table_number)}
                          disabled={actionInProgress !== null}
                        >
                          Table {table.table_number}
                        </button>
                      ))}
                    {activeTables.filter(table => {
                      const data = tableData.get(table.id) || { seated: [], waitlist: [] };
                      const isFull = data.seated.length >= (table.seats_total || 9);
                      return table.id !== movePlayer.sourceTableId && !isFull;
                    }).length === 0 && (
                      <div className="tablet-move-empty">No tables available</div>
                    )}
                  </div>
                </div>
                <div className="tablet-move-column">
                  <h4 className="tablet-move-column-title">Move to Waitlist</h4>
                  <div className="tablet-move-table-list">
                    {activeTables
                      .filter(table => table.id !== movePlayer.sourceTableId)
                      .map((table) => (
                        <button
                          key={table.id}
                          className="tablet-tc-table-btn"
                          onClick={() => handleMoveToTable(table.id, 'waitlist', table.table_number)}
                          disabled={actionInProgress !== null}
                        >
                          Table {table.table_number}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Undo Banner */}
      {lastBustAction && (
        <div className="tablet-undo-banner">
          <div className="tablet-undo-info">
            <strong>{lastBustAction.seat.player?.nick || lastBustAction.seat.player?.name || 'Player'}</strong> busted out
          </div>
          <button 
            className="tablet-undo-btn"
            onClick={handleUndoBust}
            disabled={actionInProgress !== null}
          >
            ↶ Undo
          </button>
        </div>
      )}

      {/* Page Title */}
      <div className="tablet-page-title">
        <h2>Game Waitlist - Tablet View</h2>
      </div>

      {/* Search and Filter Bar */}
      <div className="tablet-search-filter-bar">
        <div className="tablet-search-container">
          <input
            type="text"
            className="tablet-search-input"
            placeholder="Search player or table..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="tablet-filter-buttons">
          <button
            className={`tablet-filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            All
          </button>
          <button
            className={`tablet-filter-btn ${filterStatus === 'open' ? 'active' : ''}`}
            onClick={() => setFilterStatus('open')}
          >
            Open
          </button>
          <button
            className={`tablet-filter-btn ${filterStatus === 'busy' ? 'active' : ''}`}
            onClick={() => setFilterStatus('busy')}
          >
            Busy
          </button>
          <button
            className={`tablet-filter-btn ${filterStatus === 'full' ? 'active' : ''}`}
            onClick={() => setFilterStatus('full')}
          >
            Full
          </button>
        </div>
      </div>

      {/* Quick Table Navigation */}
      {activeTables.length > 0 && (
        <div className="tablet-quick-nav">
          <div className="tablet-quick-nav-label">Jump to:</div>
          <div className="tablet-quick-nav-buttons">
            {activeTables.map((table) => {
              const status = getTableStatus(table);
              return (
                <button
                  key={table.id}
                  className={`tablet-quick-nav-btn ${status}`}
                  onClick={() => {
                    const element = document.getElementById(`table-${table.id}`);
                    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {table.table_number}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Game Type Waitlist Lobby */}
      {activeTables.length > 0 && (() => {
        // Group tables by game type
        const gameTypeGroups = new Map<string, PokerTable[]>();
        activeTables.forEach(t => {
          const key = t.game_type || 'Other';
          if (!gameTypeGroups.has(key)) gameTypeGroups.set(key, []);
          gameTypeGroups.get(key)!.push(t);
        });

        // Only show lobby if there's more than 1 game type
        if (gameTypeGroups.size <= 1) return null;

        return (
          <div className="tablet-game-lobby">
            <div className="tablet-game-lobby-title">Game Type Lobby</div>
            <div className="tablet-game-lobby-grid">
              {Array.from(gameTypeGroups.entries()).map(([gameType, gameTables]) => {
                const gameLabel = gameType === 'NLH' ? 'No Limit Hold\'em' : gameType === 'BigO' ? 'Big O' : gameType === 'PLO' ? 'Pot Limit Omaha' : gameType;
                const totalSeated = gameTables.reduce((sum, t) => sum + (tableData.get(t.id)?.seated.length || 0), 0);
                const totalWaitlist = gameTables.reduce((sum, t) => sum + (tableData.get(t.id)?.waitlist.length || 0), 0);
                const totalSeats = gameTables.reduce((sum, t) => sum + (t.seats_total || 9), 0);
                const stakesLabel = [...new Set(gameTables.map(t => t.stakes_text))].join(', ');

                return (
                  <div key={gameType} className="tablet-game-lobby-card">
                    <div className="tablet-game-lobby-header">
                      <div className="tablet-game-lobby-name">{gameLabel}</div>
                      <div className="tablet-game-lobby-stakes">{stakesLabel}</div>
                    </div>
                    <div className="tablet-game-lobby-stats">
                      <div className="tablet-game-lobby-stat">
                        <span className="tablet-game-lobby-stat-value">{gameTables.length}</span>
                        <span className="tablet-game-lobby-stat-label">Table{gameTables.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="tablet-game-lobby-stat">
                        <span className="tablet-game-lobby-stat-value">{totalSeated}/{totalSeats}</span>
                        <span className="tablet-game-lobby-stat-label">Seated</span>
                      </div>
                      <div className="tablet-game-lobby-stat">
                        <span className="tablet-game-lobby-stat-value">{totalWaitlist}</span>
                        <span className="tablet-game-lobby-stat-label">Waiting</span>
                      </div>
                    </div>
                    {selectedPlayer && (
                      <button
                        className="tablet-game-lobby-add-btn"
                        disabled={actionInProgress !== null}
                        onClick={async () => {
                          const targetTables = gameTables.filter(t => t.id !== selectedPlayer.sourceTableId);
                          if (targetTables.length === 0) {
                            showToast('No other tables of this game type', 'error');
                            return;
                          }
                          for (const t of targetTables) {
                            try {
                              await addPlayerToWaitlist(t.id, selectedPlayer.player.player_id, clubDay!.id, adminUser);
                            } catch (err: any) {
                              logError(`Failed to add to Table ${t.table_number}:`, err);
                            }
                          }
                          showToast(`Added to ${targetTables.length} ${gameLabel} waitlist${targetTables.length !== 1 ? 's' : ''}`, 'success');
                          setSelectedPlayer(null);
                          loadAllTableData();
                        }}
                      >
                        Add to All {gameType} Waitlists ({gameTables.filter(t => t.id !== selectedPlayer.sourceTableId).length})
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {selectedPlayer && (
        <div className="tablet-selection-banner">
          <div className="tablet-selection-info">
            <strong>
              {selectedPlayer.player.player?.nick || selectedPlayer.player.player?.name || 'Unknown'}
            </strong>
            {' '}selected from Table {tables.find(t => t.id === selectedPlayer.sourceTableId)?.table_number || '?'}
            {' '}({selectedPlayer.isFromWaitlist ? 'Waitlist' : 'Seated'})
          </div>
          <button 
            className="tablet-clear-selection"
            onClick={() => setSelectedPlayer(null)}
          >
            ✕ Clear Selection
          </button>
        </div>
      )}

      <div ref={gridRef} className="tablet-tables-grid">
        {filteredTables.map((table) => {
          const data = tableData.get(table.id) || { seated: [], waitlist: [] };
          const isFull = data.seated.length >= (table.seats_total || 9);
          const isSelected = selectedPlayer?.sourceTableId === table.id;
          const status = getTableStatus(table);

          return (
            <div
              key={table.id}
              id={`table-${table.id}`}
              className={`tablet-table-card ${status} ${isSelected ? 'selected' : ''}`}
            >
              <div className="tablet-table-header">
                <h2>Table {table.table_number}</h2>
                <div className="tablet-table-stakes">{table.stakes_text}</div>
                <div className="tablet-table-capacity">
                  {data.seated.length} / {table.seats_total || 9} Seated
                </div>
              </div>

              <div className="tablet-seated-section">
                <h3>Seated ({data.seated.length})</h3>
                <div className="tablet-players-list">
                  {data.seated.length === 0 ? (
                    <div className="tablet-empty-state">No players seated</div>
                  ) : (
                    data.seated.map((seat) => {
                      const isHovered = hoveredPlayer === seat.id;
                      const isSelected = selectedPlayer?.player.player_id === seat.player_id && selectedPlayer.sourceTableId === table.id;
                      return (
                        <div
                          key={seat.id}
                          className={`tablet-player-item seated ${isSelected ? 'selected' : ''}`}
                          onClick={() => handlePlayerClick(seat, table.id, false)}
                          onMouseEnter={() => setHoveredPlayer(seat.id)}
                          onMouseLeave={() => setHoveredPlayer(null)}
                          onTouchStart={(e) => handleTouchStart(e, seat.player_id)}
                          onTouchEnd={(e) => handleTouchEnd(e, seat, table.id, false, table.table_number)}
                          onTouchCancel={handleTouchCancel}
                        >
                          <span className="tablet-player-name">{seat.player?.nick || seat.player?.name || 'Unknown'}</span>
                          {(isHovered || isSelected) && (
                            <div className="tablet-quick-actions" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="tablet-quick-action-btn tablet-quick-bust"
                                onClick={(e) => handleQuickBust(seat, table.id, table.table_number, e)}
                                disabled={actionInProgress !== null}
                                title="Bust"
                              >
                                ✕
                              </button>
                              <button
                                className="tablet-quick-action-btn tablet-quick-move"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMovePrompt(seat, table.id);
                                }}
                                disabled={actionInProgress !== null}
                                title="Move to Another Table"
                              >
                                Move
                              </button>
                              <button
                                className="tablet-quick-action-btn tablet-quick-tc"
                                onClick={(e) => handleQuickTC(seat, table.id, e)}
                                disabled={actionInProgress !== null}
                                title="Table Change"
                              >
                                TC
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="tablet-waitlist-section">
                <h3>Waitlist ({data.waitlist.length})</h3>
                <div className="tablet-players-list">
                  {data.waitlist.length === 0 ? (
                    <div className="tablet-empty-state">No players waiting</div>
                  ) : (
                    data.waitlist.map((wl) => {
                      const isHovered = hoveredPlayer === wl.id;
                      const isSelected = selectedPlayer?.player.player_id === wl.player_id && selectedPlayer.sourceTableId === table.id;
                      return (
                        <div
                          key={wl.id}
                          className={`tablet-player-item waitlist ${isSelected ? 'selected' : ''}`}
                          onClick={() => handlePlayerClick(wl, table.id, true)}
                          onMouseEnter={() => setHoveredPlayer(wl.id)}
                          onMouseLeave={() => setHoveredPlayer(null)}
                          onTouchStart={(e) => handleTouchStart(e, wl.player_id)}
                          onTouchEnd={(e) => handleTouchEnd(e, wl, table.id, true, table.table_number)}
                          onTouchCancel={handleTouchCancel}
                        >
                          <div className="tablet-waitlist-reorder" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="tablet-reorder-btn"
                              title="Move up"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await reorderWaitlistPosition(wl.id, table.id, clubDay!.id, 'up');
                                  loadAllTableData();
                                } catch (err: any) { showToast(err.message || 'Failed', 'error'); }
                              }}
                            >▲</button>
                            <button
                              className="tablet-reorder-btn"
                              title="Move down"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await reorderWaitlistPosition(wl.id, table.id, clubDay!.id, 'down');
                                  loadAllTableData();
                                } catch (err: any) { showToast(err.message || 'Failed', 'error'); }
                              }}
                            >▼</button>
                          </div>
                          <span className="tablet-player-name">
                            {wl.player?.nick || wl.player?.name || 'Unknown'}
                            {wl.called_in && <span className="tablet-called-in">Called</span>}
                          </span>
                          {(isHovered || isSelected) && (
                            <div className="tablet-quick-actions" onClick={(e) => e.stopPropagation()}>
                              {!isFull && (
                                <button
                                  className="tablet-quick-action-btn tablet-quick-seat"
                                  onClick={(e) => handleQuickSeat(wl, table.id, e)}
                                  disabled={actionInProgress !== null}
                                  title="Seat Player"
                                >
                                  Seat
                                </button>
                              )}
                              <button
                                className="tablet-quick-action-btn tablet-quick-tc"
                                onClick={(e) => handleQuickTC(wl, table.id, e)}
                                disabled={actionInProgress !== null}
                                title="Table Change"
                              >
                                TC
                              </button>
                              <button
                                className="tablet-quick-action-btn tablet-quick-remove"
                                onClick={(e) => handleQuickRemove(wl, table.id, table.table_number, e)}
                                disabled={actionInProgress !== null}
                                title="Remove from Waitlist"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedPlayer && selectedPlayer.sourceTableId !== table.id && (
                <div className="tablet-move-actions">
                  <button
                    className="tablet-action-btn tablet-move-seat"
                    onClick={() => handleMovePlayer(table.id, 'seat')}
                    disabled={movingPlayer !== null || isFull}
                  >
                    Move to Seat
                  </button>
                  <button
                    className="tablet-action-btn tablet-move-waitlist"
                    onClick={() => handleMovePlayer(table.id, 'waitlist')}
                    disabled={movingPlayer !== null}
                  >
                    Move to Waitlist
                  </button>
                </div>
              )}

              {selectedPlayer && selectedPlayer.sourceTableId === table.id && (
                <div className="tablet-player-actions-row">
                  {!selectedPlayer.isFromWaitlist ? (
                    // Seated player → Show Bust button
                    <button
                      className="tablet-action-btn tablet-bust-btn"
                      onClick={() => handleBustPlayer(selectedPlayer.player as TableSeat, table.id, table.table_number)}
                      disabled={actionInProgress !== null}
                    >
                      Bust
                    </button>
                  ) : (
                    // Waitlisted player → Show Seat, TC, and Remove buttons
                    <>
                      {!isFull && (
                        <button
                          className="tablet-action-btn tablet-move-seat"
                          onClick={() => handleMovePlayer(table.id, 'seat')}
                          disabled={movingPlayer !== null || actionInProgress !== null}
                        >
                          Seat
                        </button>
                      )}
                      <button
                        className="tablet-action-btn tablet-tc-btn"
                        onClick={() => handleTCPrompt(selectedPlayer.player, table.id)}
                        disabled={actionInProgress !== null}
                      >
                        TC
                      </button>
                      <button
                        className="tablet-action-btn tablet-remove-btn"
                        onClick={() => handleRemoveFromWaitlist(selectedPlayer.player as TableWaitlist, table.id, table.table_number)}
                        disabled={actionInProgress !== null}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Placeholder cards to fill grid */}
        {Array.from({ length: placeholdersNeeded }).map((_, index) => (
          <div key={`placeholder-${index}`} className="tablet-placeholder-card">
            <div className="tablet-placeholder-content">
              <div className="tablet-placeholder-logo">
                <Logo />
              </div>
              <p className="tablet-placeholder-text">No table assigned</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
