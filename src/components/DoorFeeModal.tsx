import { useState, useEffect } from 'react';
import { showToast } from './Toast';
import type { PokerTable } from '../types';
import { logError } from '../lib/logger';
import './DoorFeeModal.css';

const SAVED_DOOR_FEES_KEY = 'saved-door-fees';

function loadSavedDoorFees(): number[] {
  try {
    const saved = localStorage.getItem(SAVED_DOOR_FEES_KEY);
    if (saved) {
      const fees = JSON.parse(saved);
      return Array.isArray(fees) ? fees.filter((f: any) => typeof f === 'number' && f > 0).sort((a, b) => a - b) : [];
    }
  } catch (error) {
    logError('Error loading saved door fees:', error);
  }
  return [];
}

interface DoorFeeModalProps {
  playerName: string;
  defaultAmount?: number;
  onConfirm: (amount: number, tableId: string, isPreviousPlayer?: boolean) => Promise<void>;
  onClose: () => void;
  // Optional: If provided, show table selection
  tables?: PokerTable[];
  showTableSelection?: boolean;
  defaultTableId?: string;
  title?: string;
}

export default function DoorFeeModal({ 
  playerName, 
  defaultAmount = 20, 
  onConfirm, 
  onClose,
  tables = [],
  showTableSelection = false,
  defaultTableId,
  title = 'Pay Door Fee & Seat',
}: DoorFeeModalProps) {
  const [amount, setAmount] = useState(defaultAmount.toString());
  const [loading, setLoading] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState(defaultTableId || '');
  const [isPreviousPlayer, setIsPreviousPlayer] = useState(false);
  const [savedFees] = useState<number[]>(() => loadSavedDoorFees());

  useEffect(() => {
    // If default amount is not 20, use custom mode
    if (defaultAmount !== 20) {
      setUseCustom(true);
      const input = document.getElementById('door-fee-input');
      if (input) {
        setTimeout(() => {
          input.focus();
          (input as HTMLInputElement).select();
        }, 100);
      }
    }
  }, [defaultAmount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Previous player skips door fee entirely
    if (isPreviousPlayer) {
      if (showTableSelection && !selectedTableId) {
        showToast('Please select a table', 'error');
        return;
      }
      setLoading(true);
      try {
        await onConfirm(0, selectedTableId, true);
        onClose();
      } catch (err: any) {
        showToast(err.message || 'Failed to seat player', 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Use the selected amount (could be $20, a saved fee, or custom)
    const feeAmount = parseFloat(amount);
    
    if (isNaN(feeAmount) || feeAmount <= 0) {
      showToast('Please enter a valid door fee amount', 'error');
      return;
    }

    // If table selection is required, validate it
    if (showTableSelection && !selectedTableId) {
      showToast('Please select a table', 'error');
      return;
    }

    setLoading(true);
    try {
      await onConfirm(feeAmount, selectedTableId, false);
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to process door fee', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSetTwenty = () => {
    setAmount('20');
    setUseCustom(false);
  };

  const handleUseCustom = () => {
    setUseCustom(true);
    const input = document.getElementById('door-fee-input');
    if (input) {
      (input as HTMLInputElement).focus();
      (input as HTMLInputElement).select();
    }
  };

  return (
    <div className="door-fee-modal-overlay" onClick={onClose}>
      <div className="door-fee-modal" onClick={(e) => e.stopPropagation()}>
        <div className="door-fee-modal-header">
          <div className="door-fee-modal-title">
            <div>
              <h3>{title}</h3>
              <p className="door-fee-subtitle">{playerName}</p>
            </div>
          </div>
          <button className="door-fee-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="door-fee-form">
          {showTableSelection && tables.length > 0 && (
            <div className="door-fee-section">
              <label className="door-fee-label">Select Table</label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="door-fee-table-select"
                required={showTableSelection}
              >
                <option value="">Select a table...</option>
                {tables
                  .filter(table => table.status !== 'CLOSED')
                  .map((table) => {
                    const seatsFilled = table.seats_filled ?? 0;
                    const waitlistCount = table.waitlist_count ?? 0;
                    const tableNumber = table.table_number;
                    const stakesText = table.stakes_text;
                    const seatsTotal = table.seats_total ?? 9;
                    return (
                      <option key={table.id} value={table.id}>
                        Table {tableNumber} — {stakesText} ({seatsFilled}/{seatsTotal} seats, {waitlistCount} waiting)
                      </option>
                    );
                  })}
              </select>
            </div>
          )}

          <div className="door-fee-section">
            <label className="door-fee-previous-player">
              <input
                type="checkbox"
                checked={isPreviousPlayer}
                onChange={(e) => setIsPreviousPlayer(e.target.checked)}
              />
              <span>Previous Player</span>
              <span className="door-fee-previous-hint">No door fee collected</span>
            </label>
          </div>

          {!isPreviousPlayer && <div className="door-fee-section">
            <label className="door-fee-label">Door Fee Amount</label>
            <div className="door-fee-options">
              <button
                type="button"
                className={`door-fee-option-btn ${!useCustom && amount === '20' ? 'active' : ''}`}
                onClick={handleSetTwenty}
              >
                $20
              </button>
              {savedFees.filter(f => f !== 20).map(fee => (
                <button
                  key={fee}
                  type="button"
                  className={`door-fee-option-btn ${!useCustom && amount === fee.toString() ? 'active' : ''}`}
                  onClick={() => { setAmount(fee.toString()); setUseCustom(false); }}
                >
                  ${fee}
                </button>
              ))}
              <button
                type="button"
                className={`door-fee-option-btn ${useCustom ? 'active' : ''}`}
                onClick={handleUseCustom}
              >
                Custom
              </button>
            </div>
            {useCustom && (
              <div className="door-fee-input-wrapper">
                <span className="door-fee-currency">$</span>
                <input
                  id="door-fee-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="door-fee-input"
                  placeholder="0.00"
                  required={useCustom}
                />
              </div>
            )}
          </div>}

          <div className="door-fee-actions">
            <button
              type="button"
              className="door-fee-cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="door-fee-confirm"
              disabled={loading || (showTableSelection && !selectedTableId)}
            >
              {loading ? 'Processing...' : isPreviousPlayer ? 'Seat Player' : `Pay $${useCustom ? (parseFloat(amount) || 0) : parseFloat(amount) || 20} & Seat`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
