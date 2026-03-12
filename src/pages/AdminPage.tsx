// AdminPage - Updated to remove observeQuery and use polling instead
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { getActiveClubDay, getTablesForClubDay, createClubDay, checkClubDayStale, getSeatedPlayersForTable, getSeatedPlayersForPlayer, getWaitlistForTable, autoFixTableIntegrity, purgeOldPlayers, recoverRecentlyRemovedPlayers, collectBuyIn, getCheckInForPlayer, addPlayerToWaitlist, removePlayerFromWaitlist, removePlayerFromSeat, seatPlayer, createPlayer, createTable, swapWaitlistAddedAt } from '../lib/api';
import { getPendingSignupsFromDB, removePendingSignupFromDB } from '../lib/pendingSignups';
import type { PendingSignup } from '../lib/pendingSignups';
import { initializeLocalPlayers, upsertPlayerLocal } from '../lib/localStoragePlayers';
import { getPersistentTables, getTableWaitlist, addToPersistentWaitlist, removeFromPersistentWaitlist, listenForPersistentTableUpdates } from '../lib/persistentTables';
import type { ClubDay, PokerTable, PersistentTable, PersistentTableWaitlist } from '../types';
import AdminHeader from '../components/AdminHeader';
import TableCard from '../components/TableCard';
import PersistentWaitlistModal from '../components/PersistentWaitlistModal';
import CheckInModal from '../components/CheckInModal';
import RefundModal from '../components/RefundModal';
import AddTableModal from '../components/AddTableModal';
import ReportsModal from '../components/ReportsModal';
import CashReconciliationModal from '../components/CashReconciliationModal';
import ResetDayModal from '../components/ResetDayModal';
import TableManagementModal from '../components/TableManagementModal';
import FixDoubleSeatingModal from '../components/FixDoubleSeatingModal';
import PlayerManagementModal from '../components/PlayerManagementModal';
import BulkMoveModal from '../components/BulkMoveModal';
import BreakTableModal from '../components/BreakTableModal';
import QuickStartTutorial from '../components/QuickStartTutorial';
import KnowledgeBaseModal from '../components/KnowledgeBaseModal';
import NewDayNotification from '../components/NewDayNotification';
import { TableCardSkeleton } from '../components/LoadingSkeleton';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import Tooltip from '../components/Tooltip';
import DoorFeeModal from '../components/DoorFeeModal';
import BulkAddTestPlayers from '../components/BulkAddTestPlayers';
import BulkBustOutModal from '../components/BulkBustOutModal';
import BustedPlayersModal from '../components/BustedPlayersModal';
import QRCodeModal from '../components/QRCodeModal';
import SMSSettingsModal from '../components/SMSSettingsModal';
import HighHandModal from '../components/HighHandModal';
import { showToast } from '../components/Toast';
import '../components/AddTableModal.css';
import { log, logWarn, logError } from '../lib/logger';
import { getSMSSettings, getSMSKeyFromDB, sendSMS } from '../lib/sms';
import type { TableSeat, TableWaitlist } from '../types';
import './AdminPage.css';

interface AdminPageProps {
  user: any;
}

export interface SelectedPlayerEntry {
  playerId: string;
  playerNick?: string;
  sourceTableId: string;
  fromWaitlist: boolean;
  entryId: string;
}

export default function AdminPage({ user }: AdminPageProps) {
  const [clubDay, setClubDay] = useState<ClubDay | null>(null);
  const [tables, setTables] = useState<PokerTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [showAddTable, setShowAddTable] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showCashRecon, setShowCashRecon] = useState(false);
  const [showResetDay, setShowResetDay] = useState(false);
  const [showTableManagement, setShowTableManagement] = useState(false);
  const [showFixDoubleSeating, setShowFixDoubleSeating] = useState(false);
  const [showPlayerManagement, setShowPlayerManagement] = useState(false);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [showBreakTable, setShowBreakTable] = useState(false);
  const [breakTableSourceId, setBreakTableSourceId] = useState<string | null>(null);
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, SelectedPlayerEntry>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGameType, setFilterGameType] = useState<string>('all');
  const [showTutorial, setShowTutorial] = useState(false);
  const [seatedPlayersMap, setSeatedPlayersMap] = useState<Map<string, TableSeat[]>>(new Map());
  const [waitlistPlayersMap, setWaitlistPlayersMap] = useState<Map<string, TableWaitlist[]>>(new Map());
  const [quickFilter, setQuickFilter] = useState<'all' | 'empty' | 'full' | 'waitlist'>('all');
  const [showPlayersPopup, setShowPlayersPopup] = useState(false);
  const [checkInStatusMap, setCheckInStatusMap] = useState<Map<string, { hasPaid: boolean; amount: number; isPrevious: boolean }>>(new Map());
  const [buyInModal, setBuyInModal] = useState<{ entry: TableWaitlist; playerName: string; defaultAmount: number; hasAlreadyPaid?: boolean } | null>(null);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  
  // Persistent tables state
  const [persistentTables, setPersistentTables] = useState<PersistentTable[]>([]);
  const [persistentWaitlists, setPersistentWaitlists] = useState<Map<string, PersistentTableWaitlist[]>>(new Map());
  const [showPersistentWaitlistModal, setShowPersistentWaitlistModal] = useState<string | null>(null);
  const [showAddPlayerToWaitlist, setShowAddPlayerToWaitlist] = useState<string | null>(null);
  const [dismissedNewDayNotification, setDismissedNewDayNotification] = useState(() => {
    // Check if notification was already dismissed for current day
    const dismissed = localStorage.getItem('new-day-notification-dismissed');
    return dismissed === 'true';
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [collapsedGameTypes, setCollapsedGameTypes] = useState<Set<string>>(new Set());
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [showBulkBustOut, setShowBulkBustOut] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showSMSSettings, setShowSMSSettings] = useState(false);
  const [showHighHand, setShowHighHand] = useState(false);
  const [highHandVisible, setHighHandVisible] = useState(() => {
    return localStorage.getItem('high-hand-feature-visible') !== 'false';
  });
  const [showBustedPlayers, setShowBustedPlayers] = useState(false);
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>([]);
  const [tcSeatModal, setTcSeatModal] = useState<{ waitlist: TableWaitlist; gameType: string; stakes: string } | null>(null);
  const dismissedTokensRef = useRef<Set<string>>(new Set());
  const [isPurgingPlayers, setIsPurgingPlayers] = useState(false);
  const [isRecoveringPlayers, setIsRecoveringPlayers] = useState(false);
  const [hiddenTableIds, setHiddenTableIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('hidden-table-ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showHiddenTables, setShowHiddenTables] = useState(false);
  const adminUser = user.signInDetails?.loginId || user.username || 'admin';

  const handleHideTable = useCallback((tableId: string) => {
    setHiddenTableIds(prev => {
      const next = new Set(prev);
      next.add(tableId);
      localStorage.setItem('hidden-table-ids', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleUnhideTable = useCallback((tableId: string) => {
    setHiddenTableIds(prev => {
      const next = new Set(prev);
      next.delete(tableId);
      localStorage.setItem('hidden-table-ids', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Build a set of API table IDs and table numbers that are persistent
  const persistentApiTableIds = useMemo(() => {
    const ids = new Set<string>();
    persistentTables.forEach(pt => {
      if (pt.api_table_id) ids.add(pt.api_table_id);
    });
    return ids;
  }, [persistentTables]);

  const persistentTableNumbers = useMemo(() => {
    const nums = new Set<number>();
    // Only use table_number fallback for entries without an api_table_id
    persistentTables.filter(pt => !pt.api_table_id).forEach(pt => nums.add(pt.table_number));
    return nums;
  }, [persistentTables]);

  const handleRecoverPlayers = async () => {
    const confirmed = window.confirm(
      'Full State Restore\n\nThis will restore everything from the last hour:\n• Re-open the original club day\n• Delete any empty new day created by an accidental reset\n• Re-open closed tables\n• Restore all seated players\n• Restore all waitlist entries\n• Restore all check-ins\n• Remove Unknown/orphaned player entries\n\nContinue?'
    );
    if (!confirmed) return;
    setIsRecoveringPlayers(true);
    try {
      const result = await recoverRecentlyRemovedPlayers(adminUser, 60);
      const lines = [
        `Full restore complete:`,
        `• Seats restored: ${result.seatsRestored}`,
        `• Waitlist restored: ${result.waitlistRestored}`,
        `• Tables re-opened: ${result.tablesReopened}`,
        `• Check-ins restored: ${result.checkInsRestored}`,
        `• Unknown entries removed: ${result.orphansRemoved}`,
        `• Empty new day deleted: ${result.newDayDeleted ? 'Yes' : 'No'}`,
      ];
      if (result.errors.length > 0) {
        alert(lines.join('\n') + '\n\nErrors:\n' + result.errors.slice(0, 5).join('\n'));
      } else {
        alert(lines.join('\n'));
      }
      await refreshData();
    } catch (err: any) {
      alert('Restore failed: ' + (err.message || String(err)));
    } finally {
      setIsRecoveringPlayers(false);
    }
  };

  const handlePurgeOldPlayers = async () => {
    const confirmed = window.confirm(
      'Purge players inactive for 90+ days?\n\nThis will permanently delete all Player records with no check-in in the last 90 days. This cannot be undone.\n\nContinue?'
    );
    if (!confirmed) return;
    setIsPurgingPlayers(true);
    try {
      const result = await purgeOldPlayers(adminUser, 90);
      const msg = `Purge complete:\n• Scanned: ${result.scanned} players\n• Deleted: ${result.deleted}\n• Skipped (local): ${result.skipped}\n• Errors: ${result.errors.length}`;
      if (result.errors.length > 0) {
        alert(msg + '\n\nErrors:\n' + result.errors.slice(0, 5).join('\n'));
      } else {
        alert(msg);
      }
    } catch (err: any) {
      alert('Purge failed: ' + (err.message || String(err)));
    } finally {
      setIsPurgingPlayers(false);
    }
  };

  // Persistent table handlers
  const handleAddPlayerToWaitlist = (persistentTableId: string, playerName: string, playerPhone: string) => {
    try {
      const result = addToPersistentWaitlist(persistentTableId, playerName, playerPhone);
      if (result) {
        showToast(`Added ${playerName} to waitlist at position ${result.position}`, 'success');
        
        // Refresh waitlist
        const updatedWaitlist = getTableWaitlist(persistentTableId);
        setPersistentWaitlists(prev => new Map(prev.set(persistentTableId, updatedWaitlist)));
      } else {
        showToast('Failed to add player to waitlist', 'error');
      }
    } catch (error) {
      showToast('Error adding player to waitlist', 'error');
    }
  };

  const handleRemovePlayerFromWaitlist = (waitlistId: string, persistentTableId: string) => {
    try {
      const success = removeFromPersistentWaitlist(waitlistId);
      if (success) {
        showToast('Player removed from waitlist', 'success');
        
        // Refresh waitlist
        const updatedWaitlist = getTableWaitlist(persistentTableId);
        setPersistentWaitlists(prev => new Map(prev.set(persistentTableId, updatedWaitlist)));
      } else {
        showToast('Failed to remove player from waitlist', 'error');
      }
    } catch (error) {
      showToast('Error removing player from waitlist', 'error');
    }
  };

  // Refresh data without running auto-reset logic
  const refreshData = async () => {
    try {
      const activeDay = await getActiveClubDay();
      if (!activeDay) {
        setClubDay(null);
        setTables([]);
        setSeatedPlayersMap(new Map());
        setWaitlistPlayersMap(new Map());
        setLoading(false);
        return;
      }
      
      setClubDay(activeDay);
      const tablesData = await getTablesForClubDay(activeDay.id);
      // Tables loaded successfully

      // Patch is_persistent flag using persistent table metadata
      const pts = getPersistentTables();
      const ptIds = new Set(pts.filter(pt => pt.api_table_id).map(pt => pt.api_table_id));
      // Only use table_number fallback for persistent entries that have NO api_table_id
      const ptNumsNoId = new Set(pts.filter(pt => !pt.api_table_id).map(pt => pt.table_number));
      tablesData.forEach(t => {
        if (ptIds.has(t.id) || ptNumsNoId.has(t.table_number)) t.is_persistent = true;
      });

      setTables(tablesData);

      // Load player data for table cards and called-in waiting room
      const seatedMap = new Map<string, TableSeat[]>();
      const waitlistMap = new Map<string, TableWaitlist[]>();
      
      const openTables = tablesData.filter((table) => table.status !== 'CLOSED');
      for (const table of openTables) {
        try {
          const [seated, waitlist] = await Promise.all([
            getSeatedPlayersForTable(table.id),
            getWaitlistForTable(table.id, activeDay.id),
          ]);
          seatedMap.set(table.id, seated);
          waitlistMap.set(table.id, waitlist);
        } catch (error) {
          logError(`Error loading data for table ${table.id}:`, error);
        }
      }
      
      setSeatedPlayersMap(seatedMap);
      setWaitlistPlayersMap(waitlistMap);
      
      // Notify tablet/TV of data changes
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({ type: 'table-update', action: 'refresh' });
        channel.close();
      } catch { /* not supported */ }
      localStorage.setItem('table-updated', Date.now().toString());
    } catch (error) {
      logError('Error loading data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Initial load: initialize and load data (no auto-reset — resets are manual via EOD)
  const loadData = async () => {
    try {
      // Initialize localStorage players system
      initializeLocalPlayers();
      
      // Load the data
      await refreshData();
    } catch (error) {
      logError('Error in initial load:', error);
      setError(error instanceof Error ? error.message : 'Failed to load data');
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    
    // Tutorial is available via Help menu but no longer auto-launches
  }, [loading]);

  // Load persistent tables and set up real-time sync
  useEffect(() => {
    // Load persistent tables
    const tables = getPersistentTables();
    setPersistentTables(tables);
    
    // Load waitlists for all persistent tables
    const waitlists = new Map<string, PersistentTableWaitlist[]>();
    tables.forEach(table => {
      waitlists.set(table.id, getTableWaitlist(table.id));
    });
    setPersistentWaitlists(waitlists);
    
    // Set up real-time sync for persistent tables
    const cleanup = listenForPersistentTableUpdates(() => {
      // Reload persistent tables when updates occur
      const updatedTables = getPersistentTables();
      setPersistentTables(updatedTables);
      
      // Reload waitlists
      const updatedWaitlists = new Map<string, PersistentTableWaitlist[]>();
      updatedTables.forEach(table => {
        updatedWaitlists.set(table.id, getTableWaitlist(table.id));
      });
      setPersistentWaitlists(updatedWaitlists);
    });
    
    return cleanup;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
      // Escape to clear search
      if (e.key === 'Escape' && searchQuery) {
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [searchQuery]);

  useEffect(() => {
    if (!clubDay) return;

    // Polling for updates — fallback only; BroadcastChannel handles instant updates
    const pollInterval = setInterval(() => {
      if (document.hidden) return;
      getTablesForClubDay(clubDay.id)
        .then(fetched => {
          const pts = getPersistentTables();
          const ptIds = new Set(pts.filter(pt => pt.api_table_id).map(pt => pt.api_table_id));
          const ptNumsNoId = new Set(pts.filter(pt => !pt.api_table_id).map(pt => pt.table_number));
          fetched.forEach(t => {
            if (ptIds.has(t.id) || ptNumsNoId.has(t.table_number)) t.is_persistent = true;
          });
          setTables(fetched);
        })
        .catch((err) => {
          logError('Error polling tables:', err);
        });
      // Poll pending signups from DynamoDB (filter out dismissed/confirmed tokens)
      getPendingSignupsFromDB().then(fetched => {
        const filtered = fetched.filter(ps => ps.clubDayId === clubDay.id && !dismissedTokensRef.current.has(ps.token));
        setPendingSignups(filtered);
      }).catch(() => {});
    }, 3000); // 3s polling for near-realtime cross-device sync

    // Initial load of pending signups
    getPendingSignupsFromDB().then(fetched => {
      const filtered = fetched.filter(ps => ps.clubDayId === clubDay.id && !dismissedTokensRef.current.has(ps.token));
      setPendingSignups(filtered);
    }).catch(() => {});

    // Auto-fix integrity issues silently in the background (every 30 seconds)
    const autoFixInterval = setInterval(async () => {
      try {
        // Skip auto-fix if bulk operation is in progress
        const bulkOperationInProgress = localStorage.getItem('bulk-operation-in-progress');
        if (bulkOperationInProgress === 'true') {
          // Skipping auto-fix: bulk operation in progress
          return;
        }

        const result = await autoFixTableIntegrity(clubDay.id);
        if (result.fixed > 0) {
          // Auto-fixed integrity issues silently
          // Refresh tables after fixes
          const tablesData = await getTablesForClubDay(clubDay.id);
          setTables(tablesData);
        }
        if (result.errors.length > 0) {
          logError('Auto-fix errors:', result.errors);
        }
      } catch (err) {
        logError('Auto-fix interval error:', err);
      }
    }, 30000); // Run every 30 seconds

    return () => {
      clearInterval(pollInterval);
      clearInterval(autoFixInterval);
    };
  }, [clubDay]);

  // Load check-in status for waitlisted players when popup is open
  useEffect(() => {
    if (!showPlayersPopup || !clubDay) return;
    const allWaitlisted: TableWaitlist[] = (Array.from(waitlistPlayersMap.values()) as TableWaitlist[][]).flat();
    const unpaidPlayers = allWaitlisted.filter((wl: TableWaitlist) => !wl.called_in);
    if (unpaidPlayers.length === 0) return;

    const uniquePlayerIds = [...new Set(unpaidPlayers.map((wl: TableWaitlist) => wl.player_id))];
    Promise.all(
      uniquePlayerIds.map(async (playerId) => {
        const checkIn = await getCheckInForPlayer(playerId, clubDay.id).catch(() => null);
        return {
          playerId,
          hasPaid: !!checkIn,
          amount: checkIn?.door_fee_amount ?? 0,
          isPrevious: checkIn ? checkIn.door_fee_amount === 0 : false,
        };
      })
    ).then(results => {
      const map = new Map<string, { hasPaid: boolean; amount: number; isPrevious: boolean }>();
      results.forEach(({ playerId, hasPaid, amount, isPrevious }) => map.set(playerId, { hasPaid, amount, isPrevious }));
      setCheckInStatusMap(map);
    });
  }, [showPlayersPopup, waitlistPlayersMap, clubDay]);

  // Check if club day is stale (older than 24 hours) — show warning banner
  const [staleDayWarning, setStaleDayWarning] = useState<string | null>(null);
  
  useEffect(() => {
    // Check every 5 minutes if the club day is stale
    const staleCheckInterval = setInterval(async () => {
      try {
        const staleResult = await checkClubDayStale();
        if (staleResult.stale) {
          setStaleDayWarning(staleResult.reason);
        } else {
          setStaleDayWarning(null);
        }
      } catch (error) {
        logError('Error checking club day staleness:', error);
      }
    }, 300000); // Check every 5 minutes

    // Also check immediately on mount
    checkClubDayStale().then(result => {
      if (result.stale) setStaleDayWarning(result.reason);
    });

    return () => {
      clearInterval(staleCheckInterval);
    };
  }, []); // Only run once on mount

  // Real-time updates for player changes
  useEffect(() => {
    const handleBroadcastMessage = (event: MessageEvent) => {
      if (event.data?.type === 'public-waitlist-signup') {
        const { playerName, tableNumber } = event.data;
          // Public signup received
        showToast(`🆕 ${playerName} joined Table ${tableNumber} waitlist from public page`, 'success');
        handleRefresh();
      } else if (event.data?.type === 'player-update' || event.data?.type === 'table-update') {
        // Update broadcast received, triggering refresh
        handleRefresh();
      }
    };

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === 'player-updated' || event.key === 'table-updated') {
        // Storage event received, refreshing
        handleRefresh();
      }
    };

    // Listen for broadcast messages (same-origin tabs/windows)
    let broadcastChannel: BroadcastChannel | null = null;
    try {
      broadcastChannel = new BroadcastChannel('admin-updates');
      broadcastChannel.addEventListener('message', handleBroadcastMessage);
    } catch (error) {
      logWarn('BroadcastChannel not available:', error);
    }

    // Listen for storage events (cross-origin)
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      if (broadcastChannel) {
        broadcastChannel.removeEventListener('message', handleBroadcastMessage);
        broadcastChannel.close();
      }
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [clubDay]);

  // Auto-prune pending signups whose player is already on the waitlist or seated
  useEffect(() => {
    if (pendingSignups.length === 0) return;

    const allSeated = Array.from(seatedPlayersMap.values()).flat();
    const allWaitlist = Array.from(waitlistPlayersMap.values()).flat();

    // Build set of normalized phone numbers already waitlisted or seated
    const activePhones = new Set<string>();
    [...allSeated, ...allWaitlist].forEach(entry => {
      const phone = entry.player?.phone?.replace(/\D/g, '');
      if (phone) activePhones.add(phone);
    });

    const stale = pendingSignups.filter(ps => {
      const normalizedPhone = ps.playerPhone.replace(/\D/g, '');
      return activePhones.has(normalizedPhone);
    });

    if (stale.length > 0) {
      // Auto-pruning stale pending signups
      const staleTokens = new Set(stale.map(s => s.token));
      setPendingSignups(prev => prev.filter(p => !staleTokens.has(p.token)));
      // Remove from DynamoDB in background
      stale.forEach(ps => removePendingSignupFromDB(ps.token).catch(() => {}));
    }
  }, [pendingSignups, seatedPlayersMap, waitlistPlayersMap]);

  // Broadcast update to tablet/TV pages after admin makes changes
  const broadcastUpdate = useCallback((action: string, tableId?: string, playerId?: string) => {
    try {
      const channel = new BroadcastChannel('admin-updates');
      channel.postMessage({ type: 'player-update', action, tableId, playerId });
      channel.close();
    } catch {
      // BroadcastChannel not supported
    }
    localStorage.setItem('player-updated', Date.now().toString());
  }, []);

  const handleRefresh = () => {
    refreshData();
  };

  const seatPlayerAtTable = async (tableId: string, wl: TableWaitlist) => {
    try {
      // Check if player is already seated elsewhere (TC player)
      let wasTC = false;
      try {
        const existingSeats = await getSeatedPlayersForPlayer(wl.player_id, clubDay.id);
        wasTC = existingSeats.length > 0;
      } catch { /* best effort */ }

      await seatPlayer(tableId, wl.player_id, clubDay.id, adminUser);
      await removePlayerFromWaitlist(wl.id, adminUser);
      
      // If TC player, remove from previous table(s)
      if (wasTC) {
        try {
          const allSeats = await getSeatedPlayersForPlayer(wl.player_id, clubDay.id);
          const oldSeats = allSeats.filter(s => s.table_id !== tableId);
          for (const oldSeat of oldSeats) {
            await removePlayerFromSeat(oldSeat.id, oldSeat.table_id, adminUser);
          }
        } catch (err) {
          logError('Failed to remove TC player from previous table:', err);
        }
      }
      
      const table = tables.find(t => t.id === tableId);
      showToast(`Seated ${wl.player?.nick || 'player'} at Table ${table?.table_number}`, 'success');
      handleRefresh();
    } catch (err: any) {
      showToast(err.message || 'Failed to seat player', 'error');
    }
  };

  const handleDuplicateTable = useCallback(async (sourceTable: PokerTable) => {
    if (!clubDay) return;
    const usedNumbers = new Set(tables.map(t => t.table_number));
    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) nextNumber++;

    try {
      await createTable({
        clubDayId: clubDay.id,
        tableNumber: nextNumber,
        gameType: sourceTable.game_type || 'NLH',
        stakesText: sourceTable.stakes_text,
        seatsTotal: sourceTable.seats_total,
        bombPotCount: sourceTable.bomb_pot_count ?? 1,
        lockoutCount: sourceTable.lockout_count ?? 0,
        buyInLimits: sourceTable.buy_in_limits,
      });
      // Toast removed per user request
      handleRefresh();
    } catch (err: any) {
      showToast(err.message || 'Failed to duplicate table', 'error');
    }
  }, [clubDay, tables, handleRefresh]);

  const handleTableManagement = () => {
    setShowTableManagement(true);
  };

  const handleTogglePlayerSelection = useCallback((entry: SelectedPlayerEntry) => {
    setSelectedPlayers((prev) => {
      const existing = prev[entry.playerId];
      if (existing && existing.entryId === entry.entryId) {
        const { [entry.playerId]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [entry.playerId]: entry,
      };
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedPlayers({});
  }, []);

  // Memoize expensive computations to prevent recalculation on every render
  const uniqueTables = useMemo(() => {
    return Array.from(
      new Map(tables.map((table) => [table.table_number, table])).values()
    );
  }, [tables]);

  // Get unique game types for filter
  const gameTypes = useMemo(() => {
    return Array.from(new Set(uniqueTables.map(t => t.game_type).filter(Boolean))).sort();
  }, [uniqueTables]);

  // Dashboard stats and filter counts
  const dashboardStats = useMemo(() => {
    const activeTablesList = uniqueTables.filter(t => t.status !== 'CLOSED');
    let totalSeated = 0;
    let totalWaitlist = 0;
    let tablesWithSeats = 0;
    let fullTables = 0;
    let tablesWithWaitlist = 0;
    let emptyTables = 0;

    activeTablesList.forEach(table => {
      const seated = seatedPlayersMap.get(table.id) || [];
      const waitlist = (waitlistPlayersMap.get(table.id) || []).filter(w => !w.called_in);
      const seatedCount = seated.length;
      const maxSeats = table.seats_total || 20;

      totalSeated += seatedCount;
      totalWaitlist += waitlist.length;

      if (seatedCount === 0) {
        emptyTables++;
      }
      if (seatedCount < maxSeats) {
        tablesWithSeats++;
      }
      if (seatedCount >= maxSeats) {
        fullTables++;
      }
      if (waitlist.length > 0) {
        tablesWithWaitlist++;
      }
    });

    return {
      totalTables: activeTablesList.length,
      totalSeated,
      totalWaitlist,
      tablesWithSeats,
      fullTables,
      tablesWithWaitlist,
      emptyTables,
    };
  }, [uniqueTables, seatedPlayersMap, waitlistPlayersMap]);

  // Filter out closed tables and sort by creation time (new tables at end)
  const activeTables = useMemo(() => {
    let filtered = uniqueTables
      .filter((table) => table.status !== 'CLOSED' && !hiddenTableIds.has(table.id))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Apply filters
    if (filterGameType !== 'all') {
      filtered = filtered.filter((table) => table.game_type === filterGameType);
    }

    return filtered;
  }, [uniqueTables, filterGameType, hiddenTableIds]);

  // Hidden tables (non-closed, currently hidden by admin)
  const hiddenTables = useMemo(() => {
    return uniqueTables
      .filter((table) => table.status !== 'CLOSED' && hiddenTableIds.has(table.id))
      .sort((a, b) => a.table_number - b.table_number);
  }, [uniqueTables, hiddenTableIds]);

  const visibleWaitlistForTable = useCallback(
    (tableId: string) => (waitlistPlayersMap.get(tableId) || []),
    [waitlistPlayersMap]
  );

  
  // Calculate search results - include tables with matching players
  const filteredTablesForSearch = useMemo(() => {
    if (!searchQuery) return activeTables;
    const query = searchQuery.toLowerCase().trim();
    
    return activeTables.filter((table) => {
      // Check table properties
      const tableMatches = 
        table.table_number.toString().includes(query) ||
        table.game_type?.toLowerCase().includes(query) ||
        table.stakes_text.toLowerCase().includes(query);
      
      // Check players in this table
      const seated = seatedPlayersMap.get(table.id) || [];
      const waitlist = visibleWaitlistForTable(table.id);
      
      const hasMatchingPlayer = [...seated, ...waitlist].some(player => {
        const nick = player.player?.nick?.toLowerCase() || '';
        const name = player.player?.name?.toLowerCase() || '';
        const playerId = player.player_id?.toLowerCase() || '';
        return nick.includes(query) || name.includes(query) || playerId.includes(query);
      });
      
      return tableMatches || hasMatchingPlayer;
    });
  }, [activeTables, searchQuery, seatedPlayersMap, visibleWaitlistForTable]);

  // Group tables by game type for better visual organization
  const tablesByGameType = useMemo(() => {
    const grouped = filteredTablesForSearch.reduce((acc, table) => {
      const gameType = table.game_type || 'Other';
      if (!acc[gameType]) acc[gameType] = [];
      acc[gameType].push(table);
      return acc;
    }, {} as Record<string, typeof filteredTablesForSearch>);
    
    // Sort tables within each group by creation time (new tables at end)
    Object.keys(grouped).forEach(gameType => {
      grouped[gameType].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });
    
    return grouped;
  }, [filteredTablesForSearch]);
  
  // Sort game types in a preferred order (NLH first, then PLO, BigO, etc.)
  // Within NLH, 1/2 stakes get highest priority
  const sortedGameTypes = useMemo(() => {
    const gameTypeOrder: Record<string, number> = {
      'NLH': 1,
      'PLO': 2,
      'BigO': 3,
      'PLO5': 4,
      'Limit': 5,
      'Mixed': 6,
      'Other': 99
    };
    
    return Object.keys(tablesByGameType).sort((a, b) => {
      const orderA = gameTypeOrder[a] || 50;
      const orderB = gameTypeOrder[b] || 50;
      if (orderA !== orderB) return orderA - orderB;
      // Within same game type, prioritize groups that have 1/2 tables
      const aHas12 = tablesByGameType[a]?.some(t => (t.stakes_text || '').includes('1/2'));
      const bHas12 = tablesByGameType[b]?.some(t => (t.stakes_text || '').includes('1/2'));
      if (aHas12 && !bHas12) return -1;
      if (!aHas12 && bHas12) return 1;
      return a.localeCompare(b);
    });
  }, [tablesByGameType]);

  // Count players in search results
  const searchResultCount = useMemo(() => {
    if (!searchQuery) return null;
    const query = searchQuery.toLowerCase().trim();
    let playerMatchCount = 0;
    
    filteredTablesForSearch.forEach((table) => {
      const seated = seatedPlayersMap.get(table.id) || [];
      const waitlist = visibleWaitlistForTable(table.id);
      const matches = [...seated, ...waitlist].filter(player => {
        const nick = player.player?.nick?.toLowerCase() || '';
        const name = player.player?.name?.toLowerCase() || '';
        const playerId = player.player_id?.toLowerCase() || '';
        return nick.includes(query) || name.includes(query) || playerId.includes(query);
      });
      playerMatchCount += matches.length;
    });
    
    return {
      tables: filteredTablesForSearch.length,
      players: playerMatchCount,
    };
  }, [searchQuery, filteredTablesForSearch, seatedPlayersMap, visibleWaitlistForTable]);


  // Keyboard shortcuts
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  useKeyboardShortcuts([
    {
      key: 'k',
      ctrl: true,
      handler: () => {
        searchInputRef.current?.focus();
      },
    },
    {
      key: 'Escape',
      handler: () => {
        // Close any open modals
        setShowCheckIn(false);
        setShowRefund(false);
        setShowAddTable(false);
        setShowReports(false);
        setShowCashRecon(false);
        setShowResetDay(false);
        setShowTableManagement(false);
        setShowFixDoubleSeating(false);
        setShowPlayerManagement(false);
        setShowBulkMove(false);
        setShowBreakTable(false);
        setShowTutorial(false);
      },
    },
    {
      key: 'b',
      ctrl: true,
      handler: () => {
        setShowCheckIn(true);
      },
    },
    {
      key: 'r',
      ctrl: true,
      handler: () => {
        setShowRefund(true);
      },
    },
    {
      key: 't',
      ctrl: true,
      handler: () => {
        setShowAddTable(true);
      },
    },
  ]);

  if (loading) {
    return (
      <div className="admin-page loading">
        <AdminHeader
          clubDay={null}
          onCheckIn={() => {}}
          onRefund={() => {}}
          onAddTable={() => {}}
          onReports={() => {}}
          onOpenTV={() => {}}
          onTableManagement={() => {}}
          onResetDay={() => {}}
          onFixDoubleSeating={() => {}}
          onPlayerManagement={() => {}}
          onShowTutorial={() => {}}
          onShowKnowledgeBase={() => {}}
        />
        <div className="admin-controls">
          <div className="search-filter-bar">
            <div className="search-input" style={{ opacity: 0.5 }}>Search players or tables... (Ctrl+K)</div>
          </div>
        </div>
        <div className="tables-grid">
          <div className="game-type-tables">
            <TableCardSkeleton />
            <TableCardSkeleton />
            <TableCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-page loading">
        <div>
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => { setError(null); loadData(); }}>Retry</button>
        </div>
      </div>
    );
  }

  if (!clubDay) {
    return (
      <div className="admin-page loading">
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <h2>No Active Club Day</h2>
          <p style={{ color: '#888', marginBottom: '1.5rem' }}>
            There is no active club day. Start a new day to begin check-ins and table management.
          </p>
          <button
            className="btn-primary"
            onClick={async () => {
              setLoading(true);
              try {
                await createClubDay();
                await refreshData();
              } catch (err: any) {
                setError(err.message || 'Failed to start new day');
                setLoading(false);
              }
            }}
          >
            Start New Day
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
        {!dismissedNewDayNotification && (
          <NewDayNotification 
            clubDayId={clubDay?.id || null}
            onDismiss={() => {
              setDismissedNewDayNotification(true);
              localStorage.setItem('new-day-notification-dismissed', 'true');
            }}
          />
        )}

        {/* Stale day warning banner — nudges admin to run EOD */}
        {staleDayWarning && (
          <div className="stale-day-warning">
            <span className="stale-day-warning-icon">⚠️</span>
            <span className="stale-day-warning-text">{staleDayWarning}</span>
            <button className="btn-primary" onClick={() => setShowReports(true)}>
              Run End-of-Day Report
            </button>
            <button className="stale-day-dismiss" onClick={() => setStaleDayWarning(null)} title="Dismiss">×</button>
          </div>
        )}

        <AdminHeader
          clubDay={clubDay}
          onCheckIn={() => setShowCheckIn(true)}
          onRefund={() => setShowRefund(true)}
          onAddTable={() => setShowAddTable(true)}
          onReports={() => setShowReports(true)}
          onOpenTV={() => window.open('/tv', '_blank', 'width=1920,height=1080')}
          onTableManagement={handleTableManagement}
          onResetDay={() => setShowResetDay(true)}
          onFixDoubleSeating={() => setShowFixDoubleSeating(true)}
          onPlayerManagement={() => setShowPlayerManagement(true)}
          onShowTutorial={() => setShowTutorial(true)}
          onShowKnowledgeBase={() => setShowKnowledgeBase(true)}
          onBulkAddTestPlayers={() => setShowBulkAddModal(true)}
          onShowQRCode={() => setShowQRCode(true)}
          onCashRecon={clubDay ? () => setShowCashRecon(true) : undefined}
          onPurgeOldPlayers={isPurgingPlayers ? undefined : handlePurgeOldPlayers}
          onRecoverState={isRecoveringPlayers ? undefined : handleRecoverPlayers}
          onSMSSettings={() => setShowSMSSettings(true)}
          onHighHand={() => setShowHighHand(true)}
          highHandVisible={highHandVisible}
          onToggleHighHandVisible={() => {
            const next = !highHandVisible;
            setHighHandVisible(next);
            localStorage.setItem('high-hand-feature-visible', next ? 'true' : 'false');
          }}
        />

      {/* Dashboard Summary Bar */}
      <div className="dashboard-summary">
        <div className="summary-stat">
          <div className="summary-content">
            <span className="summary-value">{dashboardStats.totalTables}</span>
            <span className="summary-label">Active Tables</span>
          </div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <div className="summary-content">
            <span className="summary-value">{dashboardStats.totalSeated}</span>
            <span className="summary-label">Players Seated</span>
          </div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <div className="summary-content">
            <span className="summary-value">{dashboardStats.totalWaitlist}</span>
            <span className="summary-label">On Waitlist</span>
          </div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat summary-stat-highlight">
          <div className="summary-content">
            <span className="summary-value">{dashboardStats.tablesWithSeats}</span>
            <span className="summary-label">Have Seats</span>
          </div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat summary-stat-warning">
          <div className="summary-content">
            <span className="summary-value">{dashboardStats.fullTables}</span>
            <span className="summary-label">Full Tables</span>
          </div>
        </div>
      </div>

      {/* Search and View Controls */}
      <div className="admin-controls">
        <div className="search-filter-bar">
          <div className="search-input-wrapper">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search players or tables... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                className="search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <button
            className="busted-players-btn"
            onClick={() => setShowBustedPlayers(true)}
            title="View recently busted players"
          >
            💀 Busted
          </button>
          {searchResultCount && (
            <div className="search-results-count">
              {searchResultCount.tables} table{searchResultCount.tables !== 1 ? 's' : ''} found
              {searchResultCount.players > 0 && (
                <span className="search-hint"> • {searchResultCount.players} player{searchResultCount.players !== 1 ? 's' : ''} match{searchResultCount.players !== 1 ? '' : 'es'}</span>
              )}
            </div>
          )}
          <div className="quick-filters">
            <Tooltip content="Show all tables">
              <button
                className={`quick-filter-btn ${quickFilter === 'all' ? 'active' : ''}`}
                onClick={() => setQuickFilter('all')}
              >
                All
                <span className="filter-count">{dashboardStats.totalTables}</span>
              </button>
            </Tooltip>
            <Tooltip content="Show only empty tables">
              <button
                className={`quick-filter-btn quick-filter-empty ${quickFilter === 'empty' ? 'active' : ''}`}
                onClick={() => setQuickFilter('empty')}
              >
                Empty
                <span className="filter-count">{dashboardStats.emptyTables}</span>
              </button>
            </Tooltip>
            <Tooltip content="Show only full tables">
              <button
                className={`quick-filter-btn quick-filter-full ${quickFilter === 'full' ? 'active' : ''}`}
                onClick={() => setQuickFilter('full')}
              >
                Full
                <span className="filter-count">{dashboardStats.fullTables}</span>
              </button>
            </Tooltip>
            <Tooltip content="Show tables with waitlist">
              <button
                className={`quick-filter-btn quick-filter-waitlist ${quickFilter === 'waitlist' ? 'active' : ''}`}
                onClick={() => setQuickFilter('waitlist')}
              >
                Waitlist
                <span className="filter-count">{dashboardStats.tablesWithWaitlist}</span>
              </button>
            </Tooltip>
            <Tooltip content="Show tables with available seats">
              <button
                className={`quick-filter-btn quick-filter-available ${quickFilter === 'all' ? '' : ''}`}
                onClick={() => {
                  // Toggle a special filter for tables with seats
                  setQuickFilter('all');
                  setFilterGameType('all');
                }}
              >
                Has Seats
                <span className="filter-count filter-count-success">{dashboardStats.tablesWithSeats}</span>
              </button>
            </Tooltip>
          </div>
          <Tooltip content="Filter tables by game type">
            <select
              value={filterGameType}
              onChange={(e) => setFilterGameType(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Game Types</option>
              {gameTypes.map((gt) => (
                <option key={gt} value={gt}>{gt}</option>
              ))}
            </select>
          </Tooltip>
        </div>
      </div>

      <div className="admin-content-wrapper">

        {/* Re-seat Panel removed per user request */}


        {/* Bulk Actions Bar */}
        {Object.keys(selectedPlayers).length > 0 && (
          <div className="bulk-actions-bar">
            <div className="bulk-actions-info">
              <span>{Object.keys(selectedPlayers).length} player{Object.keys(selectedPlayers).length !== 1 ? 's' : ''} selected</span>
            </div>
            <div className="bulk-actions-buttons">
              <button
                className="btn-secondary"
                onClick={() => {
                  const seatedCount = Object.values(selectedPlayers).filter(p => !p.fromWaitlist).length;
                  if (seatedCount > 0) {
                    setShowBulkBustOut(true);
                  } else {
                    showToast('Only seated players can be busted out', 'error');
                  }
                }}
              >
                Bulk Bust Out ({Object.values(selectedPlayers).filter(p => !p.fromWaitlist).length})
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowBulkMove(true)}
              >
                Bulk Move ({Object.keys(selectedPlayers).length})
              </button>
              <button
                className="btn-secondary"
                onClick={handleClearSelection}
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}

        <div className="tables-grid">
        {activeTables.length === 0 ? (
          <div className="empty-state">
            <h3>No Active Tables</h3>
            <p>Get started by creating your first table</p>
            <button className="btn-primary" onClick={() => setShowAddTable(true)}>
              Add Table
            </button>
          </div>
        ) : filteredTablesForSearch.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <h3>No Tables Match Your Search</h3>
            <p>
              {filterGameType !== 'all' 
                ? `No ${filterGameType} tables match "${searchQuery}"`
                : `No tables match "${searchQuery}"`}
            </p>
            <div className="empty-state-actions">
              <button className="btn-secondary" onClick={() => setSearchQuery('')}>
                Clear Search
              </button>
              {filterGameType !== 'all' && (
                <button className="btn-secondary" onClick={() => setFilterGameType('all')}>
                  Clear Filter
                </button>
              )}
            </div>
          </div>
        ) : (
          sortedGameTypes.map((gameType) => {
            const gameTables = tablesByGameType[gameType];
            const isCollapsed = collapsedGameTypes.has(gameType);
            const toggleCollapse = () => {
              setCollapsedGameTypes(prev => {
                const next = new Set(prev);
                if (next.has(gameType)) {
                  next.delete(gameType);
                } else {
                  next.add(gameType);
                }
                return next;
              });
            };
            
            return (
            <div key={gameType} className={`game-type-group ${isCollapsed ? 'collapsed' : ''}`}>
              <div 
                className="game-type-header clickable"
                onClick={toggleCollapse}
              >
                <div className="game-type-header-left">
                  <span className={`collapse-arrow ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
                  <h3>{gameType}</h3>
                </div>
                <span className="table-count">{gameTables.length} table{gameTables.length !== 1 ? 's' : ''}</span>
              </div>
              {!isCollapsed && (
              <div className={`game-type-tables ${gameTables.length <= 3 ? 'center-few' : ''}`}>
                {gameTables
                  .filter((table) => {
                    // Use the filteredTablesForSearch which already includes player matching
                    return filteredTablesForSearch.includes(table);
                  })
                  .map((table) => (
                    <TableCard
                      key={table.id}
                      table={table}
                      clubDayId={clubDay!.id}
                      adminUser={user.signInDetails?.loginId || user.username || 'admin'}
                      allTables={uniqueTables}
                      onRefresh={handleRefresh}
                      selectedPlayers={selectedPlayers}
                      onTogglePlayerSelection={handleTogglePlayerSelection}
                      onBreakTable={(tableId) => {
                        setBreakTableSourceId(tableId);
                        setShowBreakTable(true);
                      }}
                      searchQuery={searchQuery}
                      isPersistent={persistentApiTableIds.has(table.id) || persistentTableNumbers.has(table.table_number)}
                      onHideTable={handleHideTable}
                      onDuplicateTable={handleDuplicateTable}
                    />
                  ))
                }
              </div>
              )}
            </div>
          );})
        
        )}
        
        </div>

        {/* Hidden Tables Section */}
        {hiddenTables.length > 0 && (
          <div className="hidden-tables-section">
            <button
              className="hidden-tables-toggle"
              onClick={() => setShowHiddenTables(!showHiddenTables)}
            >
              <span className={`collapse-arrow ${showHiddenTables ? '' : 'collapsed'}`}>▼</span>
              Hidden Tables ({hiddenTables.length})
            </button>
            {showHiddenTables && (
              <div className="hidden-tables-list">
                {hiddenTables.map((table) => (
                  <div key={table.id} className="hidden-table-item">
                    <span className="hidden-table-name">
                      Table {table.table_number}
                      <span className="hidden-table-meta">{table.game_type} • {table.stakes_text}</span>
                    </span>
                    <button
                      className="unhide-table-btn"
                      onClick={() => handleUnhideTable(table.id)}
                    >
                      Show
                    </button>
                  </div>
                ))}
                <button
                  className="unhide-all-btn"
                  onClick={() => {
                    setHiddenTableIds(new Set());
                    localStorage.removeItem('hidden-table-ids');
                  }}
                >
                  Show All Tables
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCheckIn && (
        <CheckInModal
          clubDayId={clubDay!.id}
          adminUser={adminUser}
          tables={(() => {
            const filteredTables = uniqueTables.filter((table) => table.status !== 'CLOSED');
            // Tables filtered for CheckInModal
            return filteredTables;
          })()}
          onClose={() => setShowCheckIn(false)}
          onSuccess={handleRefresh}
        />
      )}


      {buyInModal && clubDay && (
        <DoorFeeModal
          playerName={buyInModal.playerName}
          title="Collect Buy-In"
          defaultAmount={buyInModal.defaultAmount}
          tables={[]}
          showTableSelection={false}
          hasAlreadyPaid={buyInModal.hasAlreadyPaid}
          onConfirm={async (amount, _tableId, isPreviousPlayer) => {
            if (isPreviousPlayer) {
              // Previous player: create a $0 check-in to mark them as bought in, but no receipt/accounting
              await collectBuyIn(buyInModal.entry.player_id, clubDay.id, 0, adminUser);
              // Toast removed per user request
            } else {
              await collectBuyIn(buyInModal.entry.player_id, clubDay.id, amount, adminUser);
              // Toast removed per user request
            }
            setBuyInModal(null);
            // Refresh check-in status map
            setCheckInStatusMap((prev) => {
              const next = new Map(prev);
              next.set(buyInModal.entry.player_id, { hasPaid: true, amount: buyInModal.defaultAmount, isPrevious: false });
              return next;
            });
          }}
          onClose={() => setBuyInModal(null)}
        />
      )}

      {showRefund && (
        <RefundModal
          clubDayId={clubDay!.id}
          adminUser={adminUser}
          onClose={() => setShowRefund(false)}
          onSuccess={handleRefresh}
        />
      )}

      {showAddTable && (
        <AddTableModal
          clubDayId={clubDay!.id}
          existingTableNumbers={tables.map((t) => t.table_number)}
          adminUser={adminUser}
          onClose={() => setShowAddTable(false)}
          onSuccess={handleRefresh}
        />
      )}

      {/* Persistent Table Modals */}
      {showPersistentWaitlistModal && (() => {
        const table = persistentTables.find(t => t.id === showPersistentWaitlistModal);
        if (!table) return null;
        
        return (
          <PersistentWaitlistModal
            table={table}
            waitlist={persistentWaitlists.get(table.id) || []}
            onClose={() => setShowPersistentWaitlistModal(null)}
            onAddPlayer={(playerName, playerPhone) => 
              handleAddPlayerToWaitlist(table.id, playerName, playerPhone)
            }
            onRemovePlayer={(waitlistId) => 
              handleRemovePlayerFromWaitlist(waitlistId, table.id)
            }
          />
        );
      })()}

      {showAddPlayerToWaitlist && (() => {
        const table = persistentTables.find(t => t.id === showAddPlayerToWaitlist);
        if (!table) return null;
        
        return (
          <div className="modal-overlay" onClick={() => setShowAddPlayerToWaitlist(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Add Player to Waitlist</h2>
                <button className="close-button" onClick={() => setShowAddPlayerToWaitlist(null)}>×</button>
              </div>
              <div className="modal-body">
                <div className="table-info-summary">
                  <p><strong>Table {table.table_number}</strong> - {table.game_type}</p>
                  <p>{table.stakes_text}</p>
                </div>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const playerName = formData.get('playerName') as string;
                  const playerPhone = formData.get('playerPhone') as string;
                  handleAddPlayerToWaitlist(table.id, playerName, playerPhone);
                  setShowAddPlayerToWaitlist(null);
                }}>
                  <div className="form-group">
                    <label>Player Name *</label>
                    <input
                      type="text"
                      name="playerName"
                      placeholder="Enter player name"
                      required
                      maxLength={50}
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone Number *</label>
                    <input
                      type="tel"
                      name="playerPhone"
                      placeholder="Enter phone number"
                      required
                      pattern="[0-9\-\s\(\)]+"
                    />
                  </div>
                  <div className="form-actions">
                    <button type="button" onClick={() => setShowAddPlayerToWaitlist(null)}>
                      Cancel
                    </button>
                    <button type="submit">
                      Add to Waitlist
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {showReports && (
        <ReportsModal
          clubDayId={clubDay!.id}
          onClose={() => setShowReports(false)}
          adminUser={adminUser}
          onDayReset={() => {
            setShowReports(false);
            localStorage.removeItem('new-day-notification-dismissed');
            setDismissedNewDayNotification(false);
            setStaleDayWarning(null);
            refreshData();
          }}
        />
      )}

      {showCashRecon && (
        <CashReconciliationModal
          clubDayId={clubDay!.id}
          adminUser={user.signInDetails?.loginId || user.username || 'admin'}
          onClose={() => setShowCashRecon(false)}
          onDayReset={() => {
            // Reload data after day reset and show new day notification
            localStorage.removeItem('new-day-notification-dismissed');
            setDismissedNewDayNotification(false);
            setStaleDayWarning(null);
            refreshData();
          }}
        />
      )}

      {showResetDay && (
        <ResetDayModal
          adminUser={user.signInDetails?.loginId || user.username || 'admin'}
          onClose={() => setShowResetDay(false)}
          onSuccess={() => {
            setShowResetDay(false);
            // Show new day notification after manual reset
            localStorage.removeItem('new-day-notification-dismissed');
            setDismissedNewDayNotification(false);
            setStaleDayWarning(null);
            refreshData();
          }}
        />
      )}

      {showTableManagement && (
        <TableManagementModal
          clubDayId={clubDay!.id}
          onClose={() => setShowTableManagement(false)}
          onUpdate={handleRefresh}
        />
      )}

      {showFixDoubleSeating && (
        <FixDoubleSeatingModal
          clubDayId={clubDay!.id}
          adminUser={user.signInDetails?.loginId || user.username || 'admin'}
          onClose={() => setShowFixDoubleSeating(false)}
          onSuccess={handleRefresh}
        />
      )}

      {showPlayerManagement && (
        <PlayerManagementModal
          clubDayId={clubDay!.id}
          adminUser={user.signInDetails?.loginId || user.username || 'admin'}
          onClose={() => setShowPlayerManagement(false)}
          onSuccess={handleRefresh}
        />
      )}

      {showBulkMove && clubDay && (
        <BulkMoveModal
          selectedPlayers={selectedPlayers}
          tables={uniqueTables}
          clubDayId={clubDay.id}
          adminUser={adminUser}
          onClose={() => setShowBulkMove(false)}
          onSuccess={handleRefresh}
          onClearSelection={handleClearSelection}
        />
      )}

      {showBulkBustOut && clubDay && (
        <BulkBustOutModal
          selectedPlayers={selectedPlayers}
          tables={uniqueTables}
          clubDayId={clubDay.id}
          adminUser={adminUser}
          onClose={() => setShowBulkBustOut(false)}
          onSuccess={handleRefresh}
          onClearSelection={handleClearSelection}
        />
      )}

      {showBreakTable && (
        <BreakTableModal
          clubDayId={clubDay!.id}
          tables={uniqueTables}
          adminUser={user.signInDetails?.loginId || user.username || 'admin'}
          onClose={() => {
            setShowBreakTable(false);
            setBreakTableSourceId(null);
          }}
          onSuccess={() => {
            handleRefresh();
            setShowBreakTable(false);
            setBreakTableSourceId(null);
          }}
          initialSourceTableId={breakTableSourceId}
        />
      )}
      {showTutorial && (
        <QuickStartTutorial
          onClose={() => setShowTutorial(false)}
        />
      )}

      {showKnowledgeBase && (
        <KnowledgeBaseModal
          onClose={() => setShowKnowledgeBase(false)}
        />
      )}

      {showQRCode && (
        <QRCodeModal
          onClose={() => setShowQRCode(false)}
        />
      )}

      {showSMSSettings && (
        <SMSSettingsModal
          onClose={() => setShowSMSSettings(false)}
        />
      )}

      {showHighHand && (
        <HighHandModal
          onClose={() => setShowHighHand(false)}
        />
      )}

      {showBustedPlayers && clubDay && (
        <BustedPlayersModal
          clubDayId={clubDay.id}
          adminUser={adminUser}
          tables={uniqueTables}
          onClose={() => setShowBustedPlayers(false)}
          onRefresh={handleRefresh}
        />
      )}

      {showBulkAddModal && clubDay && (
        <BulkAddTestPlayers
          tables={uniqueTables}
          clubDayId={clubDay.id}
          adminUser={adminUser}
          onComplete={() => {
            setShowBulkAddModal(false);
            handleRefresh();
          }}
        />
      )}

      {/* Keyboard Shortcuts Panel */}
      <div className={`shortcuts-panel ${showShortcuts ? 'open' : ''}`}>
        <button 
          className="shortcuts-toggle"
          onClick={() => setShowShortcuts(!showShortcuts)}
          title="Keyboard Shortcuts"
        >
          KB
        </button>
        {showShortcuts && (
          <div className="shortcuts-content">
            <div className="shortcuts-header">
              <span>Keyboard Shortcuts</span>
              <button className="shortcuts-close" onClick={() => setShowShortcuts(false)}>×</button>
            </div>
            <div className="shortcuts-list">
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>K</kbd>
                <span>Search</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>B</kbd>
                <span>Buy-in Player</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>R</kbd>
                <span>Refund</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>T</kbd>
                <span>Add Table</span>
              </div>
              <div className="shortcut-item">
                <kbd>Esc</kbd>
                <span>Close Modal</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Waitlist FAB — game-type panels */}
      {clubDay && (() => {
        const allWaitlist = Array.from(waitlistPlayersMap.values()).flat();
        const totalWaiting = allWaitlist.length;
        const totalBadge = totalWaiting + pendingSignups.length;

        // Group active tables by game type + stakes
        const gameTypeGroups = new Map<string, PokerTable[]>();
        uniqueTables.filter(t => t.status !== 'CLOSED').forEach(t => {
          const key = `${t.game_type || 'Other'}||${t.stakes_text || ''}`;
          if (!gameTypeGroups.has(key)) gameTypeGroups.set(key, []);
          gameTypeGroups.get(key)!.push(t);
        });

        // Build seated player IDs for TC detection
        const seatedPlayerIds = new Set(
          Array.from(seatedPlayersMap.values()).flat().map(s => s.player_id)
        );
        const tcPlayerIds = new Set<string>();
        for (const [, wlist] of waitlistPlayersMap) {
          for (const wl of wlist) {
            if (seatedPlayerIds.has(wl.player_id)) tcPlayerIds.add(wl.player_id);
          }
        }

        return (
          <>
            {/* FAB button */}
            <button
              className={`players-popup-fab ${showPlayersPopup ? 'open' : ''}`}
              onClick={() => setShowPlayersPopup((v: boolean) => !v)}
              title="Waitlist"
            >
              <span className="players-popup-fab-icon">{showPlayersPopup ? '✕' : '👥'}</span>
              <span className="players-popup-fab-label">{showPlayersPopup ? 'Close' : 'Waitlist'}</span>
              {!showPlayersPopup && totalBadge > 0 && (
                <span className="players-popup-fab-badge">{totalBadge}</span>
              )}
            </button>

            {/* Game-type waitlist panels */}
            {showPlayersPopup && (
              <div className="admin-waitlist-fab-container">
                {/* Pending signups panel */}
                {pendingSignups.length > 0 && (
                  <div className="admin-waitlist-fab-panel">
                    <div className="admin-waitlist-fab-panel-header">
                      <div className="admin-waitlist-fab-panel-name">📱 Pending</div>
                      <div className="admin-waitlist-fab-panel-meta">{pendingSignups.length} awaiting</div>
                    </div>
                    <div className="admin-waitlist-fab-panel-list">
                      {pendingSignups.map(ps => (
                        <div key={ps.token} className="popup-waitlist-item popup-waitlist-pending">
                          <div className="popup-waitlist-info">
                            <span className="popup-waitlist-name">
                              <span className="popup-waitlist-name-text">{ps.playerName}</span>
                              <span className="popup-pending-badge">Pending</span>
                            </span>
                            <span className="popup-waitlist-meta">
                              Table {ps.tableNumber} • {ps.gameType} {ps.stakesText}
                            </span>
                          </div>
                          <div className="popup-pending-actions">
                            <button
                              className="popup-pending-confirm-btn"
                              onClick={async () => {
                                try {
                                  // Always create a new player for public signups to avoid name collisions
                                  const player = await createPlayer({ name: ps.playerName, nick: ps.playerName, phone: ps.playerPhone });
                                  // Cache player in localStorage so enrichWithPlayerData finds it during refresh
                                  upsertPlayerLocal(player);
                                  const newEntry = await addPlayerToWaitlist(ps.tableId, player.id, ps.clubDayId, 'admin-override', { skipSeatCheck: true });
                                  // Optimistically update waitlist map so UI updates immediately
                                  const entryWithPlayer = { ...newEntry, player };
                                  setWaitlistPlayersMap(prev => {
                                    const updated = new Map(prev);
                                    const existing = updated.get(ps.tableId) || [];
                                    updated.set(ps.tableId, [...existing, entryWithPlayer]);
                                    return updated;
                                  });
                                  dismissedTokensRef.current.add(ps.token);
                                  await removePendingSignupFromDB(ps.token);
                                  setPendingSignups(prev => prev.filter(p => p.token !== ps.token));
                                  showToast(`✅ ${ps.playerName} added to Table ${ps.tableNumber} waitlist`, 'success');

                                  // Send waitlist confirmation SMS after admin approval (non-blocking for core flow)
                                  try {
                                    const smsSettings = getSMSSettings();
                                    const localApiKey = smsSettings.apiKey?.trim() || '';
                                    const dbApiKey = !localApiKey ? (await getSMSKeyFromDB()) || '' : '';
                                    const smsApiKey = (localApiKey || dbApiKey || '').trim();

                                    if (!ps.playerPhone?.trim()) {
                                      showToast('Added to waitlist, but SMS skipped: player has no phone number', 'error');
                                    } else if (!smsApiKey) {
                                      showToast('Added to waitlist, but SMS skipped: API key not configured', 'error');
                                    } else {
                                      const smsMessage = `Hi ${ps.playerName}! You have been added to the waitlist for Table ${ps.tableNumber} (${ps.gameType} ${ps.stakesText}). Final Table Poker Club.`;
                                      const smsResult = await sendSMS(
                                        { to: ps.playerPhone, message: smsMessage },
                                        smsApiKey
                                      );

                                      if (!smsResult.success) {
                                        logWarn('[AdminPage] Waitlist confirmation SMS failed:', smsResult.error || 'Unknown SMS error');
                                        showToast(`Added to waitlist, but SMS failed: ${smsResult.error || 'Unknown error'}`, 'error');
                                      } else {
                                        // SMS confirmation sent
                                      }
                                    }
                                  } catch (smsErr) {
                                    logWarn('[AdminPage] Waitlist confirmation SMS exception:', smsErr);
                                  }

                                  handleRefresh();
                                } catch (err: any) {
                                  showToast(err.message || 'Failed to add player', 'error');
                                }
                              }}
                            >
                              ✓ Add
                            </button>
                            <button
                              className="popup-pending-dismiss-btn"
                              onClick={async () => {
                                dismissedTokensRef.current.add(ps.token);
                                setPendingSignups(prev => prev.filter(p => p.token !== ps.token));
                                showToast(`Dismissed ${ps.playerName}`, 'success');
                                await removePendingSignupFromDB(ps.token);
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Game-type panels */}
                {Array.from(gameTypeGroups.entries()).map(([groupKey, gameTables]) => {
                  const [gameType, stakes] = groupKey.split('||');
                  const totalSeated = gameTables.reduce((sum, t) => sum + (seatedPlayersMap.get(t.id)?.length || 0), 0);
                  const totalSeats = gameTables.reduce((sum, t) => sum + (t.seats_total || 20), 0);

                  // Merge waitlists from all tables of this game type, deduplicate by player_id
                  const allEntries: { wl: TableWaitlist; tableId: string; tableNumber: number }[] = [];
                  for (const t of gameTables) {
                    const wlist = waitlistPlayersMap.get(t.id) || [];
                    for (const wl of wlist) {
                      if (wl.club_day_id === clubDay.id) {
                        allEntries.push({ wl, tableId: t.id, tableNumber: t.table_number });
                      }
                    }
                  }
                  // Sort to prioritize TC players: TCs first (by added_at), then regular players (by added_at)
                  allEntries.sort((a, b) => {
                    const aIsTC = tcPlayerIds.has(a.wl.player_id);
                    const bIsTC = tcPlayerIds.has(b.wl.player_id);
                    
                    // TC players come first
                    if (aIsTC && !bIsTC) return -1;
                    if (!aIsTC && bIsTC) return 1;
                    
                    // Within same group, sort by added_at (oldest first)
                    return new Date(a.wl.added_at).getTime() - new Date(b.wl.added_at).getTime();
                  });
                  const seenPlayerIds = new Set<string>();
                  const mergedWaitlist = allEntries.filter(({ wl }) => {
                    if (seenPlayerIds.has(wl.player_id)) return false;
                    seenPlayerIds.add(wl.player_id);
                    return true;
                  });

                  return (
                    <div key={groupKey} className="admin-waitlist-fab-panel">
                      <div className="admin-waitlist-fab-panel-header">
                        <div className="admin-waitlist-fab-panel-name">{gameType} {stakes}</div>
                        <div className="admin-waitlist-fab-panel-meta">
                          {gameTables.length} table{gameTables.length !== 1 ? 's' : ''} · {totalSeated}/{totalSeats} seated · {mergedWaitlist.length} waiting
                        </div>
                      </div>
                      <div className="admin-waitlist-fab-panel-list">
                        {mergedWaitlist.length === 0 ? (
                          <div className="players-popup-empty">No players waiting</div>
                        ) : (
                          mergedWaitlist.map(({ wl, tableId }, idx) => {
                            const isTC = tcPlayerIds.has(wl.player_id);
                            const ciStatus = checkInStatusMap.get(wl.player_id);
                            const needsBuyIn = ciStatus ? !ciStatus.hasPaid : false;
                            return (
                              <div key={wl.id} className="popup-waitlist-item">
                                <div className="admin-fab-reorder-btns">
                                  <button
                                    className="admin-fab-reorder-btn"
                                    disabled={idx === 0}
                                    title="Move up"
                                    onClick={async () => {
                                      const prev = mergedWaitlist[idx - 1];
                                      try {
                                        await swapWaitlistAddedAt(wl.id, prev.wl.id);
                                        handleRefresh();
                                      } catch { showToast('Failed to reorder', 'error'); }
                                    }}
                                  >▲</button>
                                  <button
                                    className="admin-fab-reorder-btn"
                                    disabled={idx === mergedWaitlist.length - 1}
                                    title="Move down"
                                    onClick={async () => {
                                      const next = mergedWaitlist[idx + 1];
                                      try {
                                        await swapWaitlistAddedAt(wl.id, next.wl.id);
                                        handleRefresh();
                                      } catch { showToast('Failed to reorder', 'error'); }
                                    }}
                                  >▼</button>
                                </div>
                                <div className="popup-waitlist-info">
                                  <span className="popup-waitlist-name">
                                    {isTC && <span className="admin-fab-tc-badge">TC</span>}
                                    <span className={`popup-waitlist-name-text${isTC ? ' admin-fab-tc-player' : ''}`}>{wl.player?.nick || wl.player?.name || 'Unknown'}</span>
                                    {ciStatus?.hasPaid && ciStatus.isPrevious && <span className="popup-previous-badge">Previous</span>}
                                    {ciStatus?.hasPaid && !ciStatus.isPrevious && <span className="popup-buyin-amount-badge">${ciStatus.amount}</span>}
                                  </span>
                                  <span className="popup-waitlist-meta">
                                    #{idx + 1}
                                  </span>
                                </div>
                                <div className="admin-fab-actions">
                                  <button
                                    className="admin-fab-seat-btn"
                                    title="Seat this player at the best available table"
                                    onClick={() => {
                                      if (tcPlayerIds.has(wl.player_id)) {
                                        // TC player - show modal to select table
                                        setTcSeatModal({ waitlist: wl, gameType, stakes });
                                      } else {
                                        // Regular player - seat at best available table
                                        const targetTable = gameTables
                                          .filter(t => {
                                            const seated = seatedPlayersMap.get(t.id)?.length || 0;
                                            return seated < (t.seats_total || 20) && t.status !== 'CLOSED';
                                          })
                                          .sort((a, b) => {
                                            const seatedA = seatedPlayersMap.get(a.id)?.length || 0;
                                            const seatedB = seatedPlayersMap.get(b.id)?.length || 0;
                                            return seatedB - seatedA;
                                          })[0];
                                        if (!targetTable) {
                                          showToast('No available seats at any table for this game type', 'error');
                                          return;
                                        }
                                        seatPlayerAtTable(targetTable.id, wl);
                                      }
                                    }}
                                  >
                                    Seat
                                  </button>
                                  {needsBuyIn && (
                                    <button
                                      className="popup-buyin-btn"
                                      onClick={async () => {
                                        let defaultAmount = 20;
                                        let hasAlreadyPaid = false;
                                        try {
                                          const checkIn = await getCheckInForPlayer(wl.player_id, clubDay.id);
                                          if (checkIn?.door_fee_amount) {
                                            defaultAmount = checkIn.door_fee_amount;
                                            hasAlreadyPaid = true;
                                          }
                                        } catch { /* use default */ }
                                        setBuyInModal({
                                          entry: wl,
                                          playerName: wl.player?.nick || wl.player?.name || 'Unknown',
                                          defaultAmount,
                                          hasAlreadyPaid,
                                        });
                                      }}
                                    >
                                      Buy In
                                    </button>
                                  )}
                                  <button
                                    className="admin-fab-remove-btn"
                                    title="Remove from waitlist"
                                    onClick={async () => {
                                      try {
                                        await removePlayerFromWaitlist(wl.id, adminUser);
                                        showToast(`Removed ${wl.player?.nick || 'player'} from waitlist`, 'success');
                                        handleRefresh();
                                      } catch (err: any) {
                                        showToast(err.message || 'Failed to remove', 'error');
                                      }
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}

                {totalWaiting === 0 && pendingSignups.length === 0 && gameTypeGroups.size === 0 && (
                  <div className="players-popup-empty">No active tables</div>
                )}
              </div>
            )}
          </>
        );
      })()}

    {/* TC Seat Selection Modal */}
      {tcSeatModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>Seat TC Player</h3>
              <button className="modal-close" onClick={() => setTcSeatModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Seat <strong>{tcSeatModal.waitlist.player?.nick || tcSeatModal.waitlist.player?.name || 'Player'}</strong> at which table?</p>
              <div className="table-selection-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginTop: '20px' }}>
                {tables
                  .filter(t => t.game_type === tcSeatModal.gameType && t.stakes === tcSeatModal.stakes && t.status !== 'CLOSED')
                  .map(table => {
                    const seated = seatedPlayersMap.get(table.id)?.length || 0;
                    return (
                      <button
                        key={table.id}
                        className="btn-primary"
                        onClick={() => {
                          seatPlayerAtTable(table.id, tcSeatModal.waitlist);
                          setTcSeatModal(null);
                        }}
                      >
                        Table {table.table_number}
                        <br />
                        <small>{seated} seated</small>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
