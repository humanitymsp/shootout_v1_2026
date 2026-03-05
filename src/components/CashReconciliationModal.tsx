import { useState, useEffect } from 'react';
import { createCashCount, getClubDayReport, resetClubDay } from '../lib/api';
import './CashReconciliationModal.css';

interface CashReconciliationModalProps {
  clubDayId: string;
  adminUser: string;
  onClose: () => void;
  onDayReset?: () => void; // Callback when day is reset
}

export default function CashReconciliationModal({
  clubDayId,
  adminUser,
  onClose,
  onDayReset,
}: CashReconciliationModalProps) {
  const [countedAmount, setCountedAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [systemTotal, setSystemTotal] = useState<number | null>(null);
  const [closeDayAfterRecording, setCloseDayAfterRecording] = useState(false);

  const loadSystemTotal = async () => {
    try {
      const report = await getClubDayReport(clubDayId);
      setSystemTotal(report.net_total);
    } catch (err) {
      console.error('Error loading system total:', err);
    }
  };

  useEffect(() => {
    loadSystemTotal();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const amount = parseFloat(countedAmount);
      if (isNaN(amount) || amount < 0) {
        setError('Invalid amount');
        setLoading(false);
        return;
      }

      // Record the cash count
      await createCashCount(
        'clubday',
        clubDayId,
        undefined, // shiftStart
        undefined, // shiftEnd
        amount,
        adminUser
      );

      // If user selected to close day after recording, reset the day
      if (closeDayAfterRecording) {
        try {
          await resetClubDay(adminUser);
          // Notify parent that day was reset
          if (onDayReset) {
            onDayReset();
          }
        } catch (resetErr: any) {
          setError(`Cash count recorded, but failed to close day: ${resetErr.message || 'Unknown error'}`);
          setLoading(false);
          return;
        }
      }

      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record cash count');
      setLoading(false);
    }
  };

  const variance = systemTotal !== null && countedAmount
    ? parseFloat(countedAmount) - systemTotal
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Cash Reconciliation</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="reconciliation-info">
            <div className="info-row">
              <span>System Total:</span>
              <strong>${systemTotal?.toFixed(2) || '0.00'}</strong>
            </div>
          </div>

          <div className="form-group">
            <label>Cash Counted</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={countedAmount}
              onChange={(e) => setCountedAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          {variance !== null && (
            <div className={`variance ${variance >= 0 ? 'positive' : 'negative'}`}>
              <span>Variance:</span>
              <strong>${Math.abs(variance).toFixed(2)} {variance >= 0 ? 'over' : 'short'}</strong>
            </div>
          )}

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={closeDayAfterRecording}
                onChange={(e) => setCloseDayAfterRecording(e.target.checked)}
                disabled={loading}
              />
              <span>Close day and start new day after recording cash count</span>
            </label>
            <small className="form-help-text">
              This will close the current day, clear all tables, and start a fresh day. This action cannot be undone.
            </small>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className={closeDayAfterRecording ? 'danger-button' : ''}>
              {loading 
                ? (closeDayAfterRecording ? 'Recording & Closing Day...' : 'Recording...') 
                : (closeDayAfterRecording ? 'Record Count & Close Day' : 'Record Count')
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
