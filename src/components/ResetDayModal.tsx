import { useState } from 'react';
import { resetClubDay } from '../lib/api';
import './ResetDayModal.css';

interface ResetDayModalProps {
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ResetDayModal({ adminUser, onClose, onSuccess }: ResetDayModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const handleReset = async () => {
    if (!confirmed) {
      setError('Please confirm by checking the box');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await resetClubDay(adminUser);
      // Success - onSuccess will handle closing and refreshing
      onSuccess();
    } catch (err: any) {
      console.error('Reset day error:', err);
      setError(err.message || 'Failed to reset day. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Reset Day</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="warning-box">
            <h3>Warning: This action cannot be undone</h3>
            <p>Resetting the day will:</p>
            <ul>
              <li>Close the current ClubDay</li>
              <li>Close all regular tables and clear their seated + waitlists</li>
              <li>Carry over persistent tables and their waitlists to the new ClubDay</li>
              <li>Mark all players as left</li>
              <li>Reset all check-ins for the new day (previous day's check-ins won't apply)</li>
              <li>Start a new ClubDay</li>
              <li>Auto-create default tables</li>
            </ul>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  if (error) setError(''); // Clear error when checkbox is toggled
                }}
                disabled={loading}
              />
              <span>I understand this action cannot be undone</span>
            </label>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={loading || !confirmed}
              className="danger-button"
            >
              {loading ? 'Resetting...' : 'Reset Day'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
