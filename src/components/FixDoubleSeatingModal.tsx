import { useState, useEffect } from 'react';
import { findDoubleSeatingIssues, fixDoubleSeatingIssue } from '../lib/api';
import type { DoubleSeatingIssue } from '../lib/api';
import './FixDoubleSeatingModal.css';

interface FixDoubleSeatingModalProps {
  clubDayId: string;
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function FixDoubleSeatingModal({ clubDayId, adminUser, onClose, onSuccess }: FixDoubleSeatingModalProps) {
  const [issues, setIssues] = useState<DoubleSeatingIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    scanForIssues();
  }, [clubDayId]);

  const scanForIssues = async () => {
    setLoading(true);
    setError('');
    try {
      const foundIssues = await findDoubleSeatingIssues(clubDayId);
      setIssues(foundIssues);
    } catch (err: any) {
      console.error('Error scanning for double-seating issues:', err);
      setError(err.message || 'Failed to scan for issues');
    } finally {
      setLoading(false);
    }
  };

  const handleFixIssue = async (issue: DoubleSeatingIssue, keepSeatId: string) => {
    if (!confirm(`Keep player "${issue.playerNick || issue.playerName || issue.playerId}" at the selected table and remove from other tables?`)) {
      return;
    }

    setFixing(issue.playerId);
    setError('');
    try {
      await fixDoubleSeatingIssue(issue.playerId, clubDayId, keepSeatId, adminUser);
      // Remove fixed issue from list
      setIssues(issues.filter(i => i.playerId !== issue.playerId));
      
      // Trigger refresh
      onSuccess();
      
      // If no more issues, close modal
      const remainingIssues = issues.filter(i => i.playerId !== issue.playerId);
      if (remainingIssues.length === 0) {
        setTimeout(() => {
          onClose();
        }, 1000);
      }
    } catch (err: any) {
      console.error('Error fixing double-seating issue:', err);
      setError(err.message || 'Failed to fix issue');
    } finally {
      setFixing(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content fix-double-seating-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Fix Double-Seating Issues</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state">
              <p>Scanning for double-seating issues...</p>
            </div>
          ) : error ? (
            <div className="error-message">{error}</div>
          ) : issues.length === 0 ? (
            <div className="success-state">
              <p>No double-seating issues found. All players are correctly seated at single tables.</p>
            </div>
          ) : (
            <>
              <div className="issues-header">
                <p>Found <strong>{issues.length}</strong> player{issues.length === 1 ? '' : 's'} seated at multiple tables:</p>
                <button onClick={scanForIssues} className="btn-refresh">Refresh Scan</button>
              </div>

              <div className="issues-list">
                {issues.map((issue) => (
                  <div key={issue.playerId} className="issue-item">
                    <div className="issue-header">
                      <strong>{issue.playerNick || issue.playerName || issue.playerId}</strong>
                      <span className="issue-count">Seated at {issue.seats.length} tables</span>
                    </div>
                    
                    <div className="seats-list">
                      {issue.seats.map((seat, index) => (
                        <div key={seat.seatId} className={`seat-item ${index === 0 ? 'most-recent' : ''}`}>
                          <div className="seat-info">
                            <span className="table-label">
                              Table {seat.tableNumber || 'Unknown'} 
                              {index === 0 && <span className="recent-badge">(Most Recent)</span>}
                            </span>
                            <span className="seated-time">
                              Seated: {new Date(seat.seatedAt).toLocaleString()}
                            </span>
                          </div>
                          <button
                            onClick={() => handleFixIssue(issue, seat.seatId)}
                            disabled={fixing === issue.playerId}
                            className="btn-keep-seat"
                          >
                            {fixing === issue.playerId ? 'Fixing...' : 'Keep This Seat'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn-close">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
