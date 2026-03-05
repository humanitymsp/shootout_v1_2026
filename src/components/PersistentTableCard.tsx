import type { PersistentTable, PersistentTableWaitlist } from '../types';

interface PersistentTableCardProps {
  table: PersistentTable;
  waitlist: PersistentTableWaitlist[];
  onShowWaitlist: (tableId: string) => void;
  onAddPlayer: (tableId: string) => void;
}

export default function PersistentTableCard({ 
  table, 
  waitlist, 
  onShowWaitlist, 
  onAddPlayer 
}: PersistentTableCardProps) {
  const gameTypeClass = table.game_type?.toLowerCase() || 'other';

  return (
    <div className={`table-card open game-type-${gameTypeClass} persistent-table-card-wrapper`}>
      <div className="table-header">
        <div className="table-number">
          Table {table.table_number}
          <span className="seated-count">({waitlist.length} waiting)</span>
        </div>
        <div className="table-header-actions">
          <div className="table-status-badges">
            <div className="table-status open">OPEN</div>
            {table.public_signups && (
              <span className="status-badge" style={{ background: 'rgba(139,92,246,0.2)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.4)' }}>Sign-Up</span>
            )}
          </div>
        </div>
      </div>

      <div className="table-info">
        <div className="info-badge game-type">{table.game_type}</div>
        <div className="info-badge stakes">{table.stakes_text}</div>
        <div className="info-badge buy-in-limits">
          <span className="buy-in-text">{table.buy_in_limits || 'See floor'}</span>
        </div>
        <div className="info-badge bomb-pots">
          Bomb Pots:
          <span style={{ marginLeft: '0.25rem', fontWeight: 600 }}>{table.bomb_pot_count}</span>
        </div>
      </div>

      <div className="seated-list">
        <h4>Waitlist ({waitlist.length})</h4>
        {waitlist.length === 0 ? (
          <div className="empty-list">No players signed up yet</div>
        ) : (
          waitlist.map((p) => (
            <div key={p.id} className="player-item">
              <span className="player-nick">#{p.position} {p.player_name}</span>
              <span className="player-badge" style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--admin-muted)', fontFamily: 'monospace' }}>
                {(p.player_phone || '').replace(/.(?=.{4})/g, '•')}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="table-footer-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className="btn-secondary" style={{ flex: 1, fontSize: '0.75rem' }} onClick={() => onAddPlayer(table.id)}>
          + Add Player
        </button>
        <button className="btn-secondary" style={{ flex: 1, fontSize: '0.75rem' }} onClick={() => onShowWaitlist(table.id)}>
          Manage List
        </button>
      </div>
    </div>
  );
}
