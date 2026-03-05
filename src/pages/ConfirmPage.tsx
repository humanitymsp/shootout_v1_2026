import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { findOrCreatePlayerByPhone, addPlayerToWaitlist } from '../lib/api';
import { getPendingSignup, removePendingSignup } from '../lib/pendingSignups';
import { log, logError } from '../lib/logger';
import Logo from '../components/Logo';
import './ConfirmPage.css';

type ConfirmState = 'loading' | 'confirming' | 'success' | 'expired' | 'error' | 'already';

export default function ConfirmPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState<ConfirmState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [details, setDetails] = useState<{ playerName: string; tableNumber: number; gameType: string; stakesText: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setState('expired');
      return;
    }

    (async () => {
      const pending = await getPendingSignup(token);
      if (!pending) {
        setState('expired');
        return;
      }

      setDetails({
        playerName: pending.playerName,
        tableNumber: pending.tableNumber,
        gameType: pending.gameType,
        stakesText: pending.stakesText,
      });
      setState('confirming');
    })();
  }, [token]);

  const handleConfirm = async () => {
    setState('loading');
    const pending = await getPendingSignup(token);
    if (!pending) {
      setState('expired');
      return;
    }

    try {
      const player = await findOrCreatePlayerByPhone(pending.playerName, pending.playerPhone);
      const entry = await addPlayerToWaitlist(pending.tableId, player.id, pending.clubDayId, 'public-signup', { skipSeatCheck: true });
      log(`[Confirm] Player ${pending.playerName} confirmed for Table ${pending.tableNumber}, position #${entry.position}`);

      // Broadcast to admin page
      try {
        const ch = new BroadcastChannel('admin-updates');
        ch.postMessage({
          type: 'public-waitlist-signup',
          playerName: pending.playerName,
          tableNumber: pending.tableNumber,
          tableId: pending.tableId,
        });
        ch.close();
      } catch {}
      localStorage.setItem('table-updated', new Date().toISOString());

      await removePendingSignup(token);
      setState('success');
    } catch (err: any) {
      logError('[Confirm] Error confirming signup:', err);
      if (err.message?.includes('already')) {
        setState('already');
      } else {
        setErrorMsg(err.message || 'Something went wrong. Please try again.');
        setState('error');
      }
    }
  };

  return (
    <div className="confirm-page">
      <div className="confirm-card">
        <div className="confirm-logo">
          <Logo />
        </div>

        {state === 'loading' && (
          <div className="confirm-body">
            <div className="confirm-spinner"></div>
            <p>Processing...</p>
          </div>
        )}

        {state === 'confirming' && details && (
          <div className="confirm-body">
            <h2>Confirm Waitlist Signup</h2>
            <p className="confirm-greeting">Hi {details.playerName}!</p>
            <div className="confirm-details">
              <div className="confirm-detail-row">
                <span className="confirm-label">Table</span>
                <span className="confirm-value">Table {details.tableNumber}</span>
              </div>
              <div className="confirm-detail-row">
                <span className="confirm-label">Game</span>
                <span className="confirm-value">{details.gameType} {details.stakesText}</span>
              </div>
            </div>
            <p className="confirm-prompt">Tap below to confirm your spot on the waitlist:</p>
            <button className="confirm-btn" onClick={handleConfirm}>
              Confirm — Add Me to Waitlist
            </button>
            <p className="confirm-note">This link expires in 30 minutes.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="confirm-body confirm-success">
            <div className="confirm-icon">✅</div>
            <h2>You're on the list!</h2>
            <p>You've been added to the waitlist for Table {details?.tableNumber}.</p>
            <p className="confirm-note">We'll let you know when it's your turn. See you soon!</p>
          </div>
        )}

        {state === 'already' && (
          <div className="confirm-body confirm-already">
            <div className="confirm-icon">👍</div>
            <h2>Already on the list</h2>
            <p>You're already on the waitlist for this table. No action needed!</p>
          </div>
        )}

        {state === 'expired' && (
          <div className="confirm-body confirm-expired">
            <div className="confirm-icon">⏰</div>
            <h2>Link Expired</h2>
            <p>This confirmation link has expired or is invalid.</p>
            <p className="confirm-note">Please sign up again at the public page or see the front counter.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="confirm-body confirm-error">
            <div className="confirm-icon">❌</div>
            <h2>Something went wrong</h2>
            <p>{errorMsg}</p>
            <button className="confirm-btn confirm-retry-btn" onClick={handleConfirm}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
