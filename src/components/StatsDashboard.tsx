import { useMemo } from 'react';
import type { PokerTable, TableSeat, TableWaitlist } from '../types';
import './StatsDashboard.css';

interface StatsDashboardProps {
  tables: PokerTable[];
  seatedPlayers: Map<string, TableSeat[]>;
  waitlistPlayers: Map<string, TableWaitlist[]>;
}

export default function StatsDashboard({ tables, seatedPlayers, waitlistPlayers }: StatsDashboardProps) {
  const stats = useMemo(() => {
    const activeTables = tables.filter(t => t.status !== 'CLOSED');
    let totalSeated = 0;
    let totalWaitlist = 0;
    let emptyTables = 0;
    let fullTables = 0;

    activeTables.forEach(table => {
      const seated = seatedPlayers.get(table.id) || [];
      const waitlist = waitlistPlayers.get(table.id) || [];
      
      totalSeated += seated.length;
      totalWaitlist += waitlist.length;

      if (seated.length === 0) {
        emptyTables++;
      } else if (seated.length >= table.seats_total) {
        fullTables++;
      }
    });

    return {
      totalSeated,
      totalWaitlist,
      activeTables: activeTables.length,
      emptyTables,
      fullTables,
    };
  }, [tables, seatedPlayers, waitlistPlayers]);

  return (
    <div className="stats-dashboard">
      <div className="stat-card">
        <div className="stat-value">{stats.totalSeated}</div>
        <div className="stat-label">Players Seated</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.totalWaitlist}</div>
        <div className="stat-label">On Waitlist</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.activeTables}</div>
        <div className="stat-label">Active Tables</div>
      </div>
      {stats.emptyTables > 0 && (
        <div className="stat-card stat-card-empty">
          <div className="stat-value">{stats.emptyTables}</div>
          <div className="stat-label">Empty Tables</div>
        </div>
      )}
      {stats.fullTables > 0 && (
        <div className="stat-card stat-card-full">
          <div className="stat-value">{stats.fullTables}</div>
          <div className="stat-label">Full Tables</div>
        </div>
      )}
    </div>
  );
}
