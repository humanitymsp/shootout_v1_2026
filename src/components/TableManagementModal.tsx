import { useEffect, useState } from 'react';
import { getTablesForClubDay, updateTable, deleteTable as apiDeleteTable, getSeatedPlayersForTable, getWaitlistForTable } from '../lib/api';
import type { PokerTable } from '../types';
import './TableManagementModal.css';

interface TableManagementModalProps {
  clubDayId: string;
  onClose: () => void;
  onUpdate: () => void;
}

interface EditableTable extends PokerTable {
  isEditing: boolean;
  editData: {
    table_number: number;
    game_type: PokerTable['game_type'];
    stakes_text: string;
    seats_total: number;
    bomb_pot_count: number;
    lockout_count: number;
    buy_in_limits?: string;
  };
  seatsFilled?: number;
  waitlistCount?: number;
}

export default function TableManagementModal({ clubDayId, onClose, onUpdate }: TableManagementModalProps) {
  const [tables, setTables] = useState<EditableTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [gameTypeFilter, setGameTypeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'number' | 'status' | 'seats'>('number');
  const [showStats, setShowStats] = useState(true);

  useEffect(() => {
    loadTables();
  }, [clubDayId]);

  const loadTables = async () => {
    try {
      setLoading(true);
      const tablesData = await getTablesForClubDay(clubDayId);

      // Load statistics for each table
      const tablesWithStats = await Promise.all(
        tablesData.map(async (table) => {
          try {
            const [seats, waitlist] = await Promise.all([
              getSeatedPlayersForTable(table.id),
              getWaitlistForTable(table.id),
            ]);
            return {
              ...table,
              seatsFilled: seats.length,
              waitlistCount: waitlist.length,
            };
          } catch (error) {
            console.error(`Error loading stats for table ${table.id}:`, error);
            return {
              ...table,
              seatsFilled: 0,
              waitlistCount: 0,
            };
          }
        })
      );

      // Sort by table number initially
      tablesWithStats.sort((a, b) => a.table_number - b.table_number);

      const editableTables: EditableTable[] = tablesWithStats.map(table => ({
        ...table,
        isEditing: false,
        editData: {
          table_number: table.table_number,
          game_type: table.game_type,
          stakes_text: table.stakes_text,
          seats_total: table.seats_total,
          bomb_pot_count: table.bomb_pot_count || 1,
          lockout_count: table.lockout_count || 0,
          buy_in_limits: table.buy_in_limits || '',
        }
      }));

      setTables(editableTables);
    } catch (error) {
      console.error('Error loading tables for management:', error);
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (tableId: string) => {
    setTables(prev => prev.map(table =>
      table.id === tableId
        ? { ...table, isEditing: true }
        : table
    ));
  };

  const cancelEditing = (tableId: string) => {
    setTables(prev => prev.map(table => {
      if (table.id === tableId) {
        return {
          ...table,
          isEditing: false,
          editData: {
            table_number: table.table_number,
            game_type: table.game_type,
            stakes_text: table.stakes_text,
            seats_total: table.seats_total,
            bomb_pot_count: table.bomb_pot_count || 1,
          lockout_count: table.lockout_count || 0,
          }
        } as EditableTable;
      }
      return table;
    }));
  };

  const updateEditData = (tableId: string, field: keyof EditableTable['editData'], value: string | number) => {
    setTables(prev => prev.map(table =>
      table.id === tableId
        ? {
            ...table,
            editData: {
              ...table.editData,
              [field]: value
            }
          }
        : table
    ));
  };

  const saveTable = async (table: EditableTable) => {
    try {
      setSaving(table.id);
      await updateTable(table.id, {
        table_number: table.editData.table_number,
        game_type: table.editData.game_type,
        stakes_text: table.editData.stakes_text,
        seats_total: table.editData.seats_total,
        bomb_pot_count: table.editData.bomb_pot_count,
        lockout_count: table.editData.lockout_count,
        buy_in_limits: table.editData.buy_in_limits || undefined,
      });

      setTables(prev => prev.map(t => {
        if (t.id === table.id) {
          return {
            ...t,
            table_number: t.editData.table_number,
            game_type: t.editData.game_type as PokerTable['game_type'],
            stakes_text: t.editData.stakes_text,
            seats_total: t.editData.seats_total,
            bomb_pot_count: t.editData.bomb_pot_count,
            lockout_count: t.editData.lockout_count,
            buy_in_limits: t.editData.buy_in_limits,
            isEditing: false
          } as EditableTable;
        }
        return t;
      }));

      // Trigger instant TV updates
      try {
        const channel = new BroadcastChannel('tv-updates');
        channel.postMessage({ type: 'table-updated', tableId: table.id });
        channel.close();
      } catch (error) {
        console.warn('📡 BroadcastChannel not available, using localStorage:', error);
      }
      localStorage.setItem('table-updated', new Date().toISOString());

      onUpdate();
    } catch (error) {
      console.error('Error updating table:', error);
      alert('Failed to update table');
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!confirm('Are you sure you want to delete this table? This will remove all associated player seats and waitlist entries.')) {
      return;
    }

    try {
      setDeleting(tableId);
      await apiDeleteTable(tableId);

      // Remove the table from the local state
      setTables(prev => prev.filter(t => t.id !== tableId));

      onUpdate();
    } catch (error) {
      console.error('Error deleting table:', error);
      alert('Failed to delete table');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleTV = async (tableId: string, currentValue: boolean) => {
    try {
      await updateTable(tableId, { show_on_tv: !currentValue } as any);
      setTables(prev => prev.map(t => 
        t.id === tableId ? { ...t, show_on_tv: !currentValue } : t
      ));
      
      // Broadcast update
      try {
        const channel = new BroadcastChannel('tv-updates');
        channel.postMessage({ type: 'table-updated', tableId });
        channel.close();
      } catch (error) {
        console.warn('BroadcastChannel not available:', error);
      }
      localStorage.setItem('table-updated', new Date().toISOString());
      
      onUpdate();
    } catch (error) {
      console.error('Error toggling TV display:', error);
      alert('Failed to toggle TV display');
    }
  };

  const handleStatusChange = async (tableId: string, newStatus: PokerTable['status']) => {
    try {
      await updateTable(tableId, { status: newStatus } as any);
      setTables(prev => prev.map(t => 
        t.id === tableId ? { ...t, status: newStatus } : t
      ));
      
      // Broadcast update
      try {
        const channel = new BroadcastChannel('tv-updates');
        channel.postMessage({ type: 'table-updated', tableId });
        channel.close();
      } catch (error) {
        console.warn('BroadcastChannel not available:', error);
      }
      localStorage.setItem('table-updated', new Date().toISOString());
      
      onUpdate();
    } catch (error) {
      console.error('Error changing status:', error);
      alert('Failed to change table status');
    }
  };

  // Filter and sort tables
  const filteredAndSortedTables = tables
    .filter(table => {
      const matchesSearch = !searchQuery || 
        table.table_number.toString().includes(searchQuery) ||
        table.stakes_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        table.game_type?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || table.status === statusFilter;
      const matchesGameType = gameTypeFilter === 'all' || table.game_type === gameTypeFilter;
      
      return matchesSearch && matchesStatus && matchesGameType;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'number':
          return a.table_number - b.table_number;
        case 'status':
          const statusOrder = { 'OPEN': 1, 'STARTING': 2, 'FULL': 3 };
          return (statusOrder[a.status as keyof typeof statusOrder] || 99) - 
                 (statusOrder[b.status as keyof typeof statusOrder] || 99);
        case 'seats':
          const aFill = (a.seatsFilled || 0) / a.seats_total;
          const bFill = (b.seatsFilled || 0) / b.seats_total;
          return bFill - aFill;
        default:
          return 0;
      }
    });

  // Calculate statistics
  const stats = {
    total: tables.length,
    open: tables.filter(t => t.status === 'OPEN').length,
    full: tables.filter(t => t.status === 'FULL').length,
    totalSeats: tables.reduce((sum, t) => sum + t.seats_total, 0),
    filledSeats: tables.reduce((sum, t) => sum + (t.seatsFilled || 0), 0),
    totalWaitlist: tables.reduce((sum, t) => sum + (t.waitlistCount || 0), 0),
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content table-management-modal" onClick={(e) => e.stopPropagation()}>
          <div className="table-management-loading">
            <div className="table-management-spinner"></div>
            <h3>Loading Tables...</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content table-management-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Table Management</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="table-management-content">
          {/* Statistics Panel */}
          {showStats && tables.length > 0 && (
            <div className="table-stats-panel">
              <div className="stats-header">
                <h3>Table Statistics</h3>
                <button className="toggle-stats" onClick={() => setShowStats(false)}>−</button>
              </div>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{stats.total}</div>
                  <div className="stat-label">Total Tables</div>
                </div>
                <div className="stat-card stat-open">
                  <div className="stat-value">{stats.open}</div>
                  <div className="stat-label">Open</div>
                </div>
                <div className="stat-card stat-full">
                  <div className="stat-value">{stats.full}</div>
                  <div className="stat-label">Full</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.filledSeats}/{stats.totalSeats}</div>
                  <div className="stat-label">Seats Filled</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.totalWaitlist}</div>
                  <div className="stat-label">Waitlist Total</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{Math.round((stats.filledSeats / stats.totalSeats) * 100) || 0}%</div>
                  <div className="stat-label">Capacity</div>
                </div>
              </div>
            </div>
          )}

          {!showStats && tables.length > 0 && (
            <button className="toggle-stats-btn" onClick={() => setShowStats(true)}>+ Show Statistics</button>
          )}

          {/* Search and Filter Controls */}
          {tables.length > 0 && (
            <div className="table-controls">
              <div className="search-controls">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by table number, stakes, or game type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="filter-controls">
                <select
                  className="filter-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="STARTING">Starting</option>
                  <option value="FULL">Full</option>
                </select>
                <select
                  className="filter-select"
                  value={gameTypeFilter}
                  onChange={(e) => setGameTypeFilter(e.target.value)}
                >
                  <option value="all">All Game Types</option>
                  <option value="NLH">NL Hold'em</option>
                  <option value="PLO">PLO</option>
                  <option value="BigO">Big O</option>
                  <option value="Limit">Limit</option>
                  <option value="Mixed">Mixed</option>
                  <option value="Custom">Custom</option>
                </select>
                <select
                  className="filter-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'number' | 'status' | 'seats')}
                >
                  <option value="number">Sort by Number</option>
                  <option value="status">Sort by Status</option>
                  <option value="seats">Sort by Fill %</option>
                </select>
              </div>
            </div>
          )}

          {tables.length === 0 ? (
            <div className="table-management-empty">
              <h3>No Tables Found</h3>
              <p>Add tables using the "Add Table" button.</p>
            </div>
          ) : filteredAndSortedTables.length === 0 ? (
            <div className="table-management-empty">
              <h3>No Tables Match Filters</h3>
              <p>Try adjusting your search or filter criteria.</p>
            </div>
          ) : (
            <div className="table-management-grid">
              {filteredAndSortedTables.map((table) => (
                <div key={table.id} className="table-management-card">
                  {table.isEditing ? (
                    <div className="table-edit-form">
                      <div className="form-row">
                        <label>Table Number:</label>
                        <input
                          type="number"
                          value={table.editData.table_number}
                          onChange={(e) => updateEditData(table.id, 'table_number', parseInt(e.target.value))}
                          min="1"
                          max="99"
                        />
                      </div>

                      <div className="form-row">
                        <label>Game Type:</label>
                        <select
                          value={table.editData.game_type}
                          onChange={(e) => updateEditData(table.id, 'game_type', e.target.value as PokerTable['game_type'])}
                        >
                          <option value="NLH">NL Hold'em</option>
                          <option value="BigO">Big O</option>
                          <option value="PLO">PLO</option>
                          <option value="Limit">Limit</option>
                          <option value="Mixed">Mixed</option>
                          <option value="Custom">Custom</option>
                        </select>
                      </div>

                      <div className="form-row">
                        <label>Stakes:</label>
                        <input
                          type="text"
                          value={table.editData.stakes_text}
                          onChange={(e) => updateEditData(table.id, 'stakes_text', e.target.value)}
                          placeholder="e.g., $1/$2 NL"
                        />
                      </div>

                      <div className="form-row">
                        <label>Seats:</label>
                        <input
                          type="number"
                          value={table.editData.seats_total}
                          onChange={(e) => updateEditData(table.id, 'seats_total', parseInt(e.target.value))}
                          min="2"
                          max="20"
                        />
                      </div>

                      <div className="form-row">
                        <label>Bomb Pots:</label>
                        <input
                          type="number"
                          value={table.editData.bomb_pot_count}
                          onChange={(e) => updateEditData(table.id, 'bomb_pot_count', parseInt(e.target.value))}
                          min="0"
                          max="3"
                        />
                      </div>

                      <div className="form-row">
                        <label>Lockouts:</label>
                        <input
                          type="number"
                          value={table.editData.lockout_count}
                          onChange={(e) => updateEditData(table.id, 'lockout_count', parseInt(e.target.value))}
                          min="0"
                          max="3"
                        />
                      </div>

                      <div className="form-row">
                        <label>Buy-in Limits:</label>
                        <input
                          type="text"
                          value={table.editData.buy_in_limits || ''}
                          onChange={(e) => updateEditData(table.id, 'buy_in_limits', e.target.value)}
                          placeholder="e.g., $40-$400"
                        />
                      </div>

                      <div className="form-actions">
                        <button
                          onClick={() => cancelEditing(table.id)}
                          disabled={saving === table.id}
                          className="btn-secondary"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveTable(table)}
                          disabled={saving === table.id}
                          className="btn-primary"
                        >
                          {saving === table.id ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="table-display">
                      <div className="table-header">
                        <div className="table-header-left">
                          <h3>Table {table.table_number}</h3>
                          <div className={`table-status ${table.status.toLowerCase()}`}>
                            {table.status}
                          </div>
                        </div>
                        <div className="table-header-right">
                          <button
                            className={`tv-toggle ${table.show_on_tv ? 'active' : ''}`}
                            onClick={() => handleToggleTV(table.id, table.show_on_tv ?? true)}
                            title={table.show_on_tv ? 'Hide from TV' : 'Show on TV'}
                          >
                            📺
                          </button>
                        </div>
                      </div>

                      {/* Table Statistics */}
                      <div className="table-stats-mini">
                        <div className="stat-mini">
                          <span className="stat-mini-label">Seats:</span>
                          <span className="stat-mini-value">
                            {table.seatsFilled || 0}/{table.seats_total}
                          </span>
                          <div className="stat-mini-bar">
                            <div 
                              className="stat-mini-fill" 
                              style={{ width: `${((table.seatsFilled || 0) / table.seats_total) * 100}%` }}
                            />
                          </div>
                        </div>
                        <div className="stat-mini">
                          <span className="stat-mini-label">Waitlist:</span>
                          <span className="stat-mini-value">{table.waitlistCount || 0}</span>
                        </div>
                      </div>

                      <div className="table-details">
                        <div className="detail-row">
                          <span className="label">Game:</span>
                          <span className="value">{table.game_type}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Stakes:</span>
                          <span className="value">{table.stakes_text}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Seats:</span>
                          <span className="value">{table.seats_total}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Bomb Pots:</span>
                          <span className="value">{table.bomb_pot_count || 1}</span>
                        </div>
                        {table.buy_in_limits && (
                          <div className="detail-row">
                            <span className="label">Buy-in Limits:</span>
                            <span className="value">{table.buy_in_limits}</span>
                          </div>
                        )}
                      </div>

                      {/* Quick Actions */}
                      <div className="quick-actions">
                        <select
                          className="status-select"
                          value={table.status}
                          onChange={(e) => handleStatusChange(table.id, e.target.value as PokerTable['status'])}
                        >
                          <option value="OPEN">Open</option>
                          <option value="STARTING">Starting</option>
                          <option value="FULL">Full</option>
                        </select>
                      </div>

                      <div className="table-actions">
                        <button
                          onClick={() => startEditing(table.id)}
                          className="btn-primary btn-small"
                        >
                          Edit Settings
                        </button>
                        <button
                          onClick={() => handleDeleteTable(table.id)}
                          className="btn-danger btn-small"
                          disabled={deleting === table.id}
                        >
                          {deleting === table.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="table-management-footer">
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}