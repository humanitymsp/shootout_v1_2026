import { useEffect, useState, useRef } from 'react';
import { getCheckInsForClubDay, getClubDayReport } from '../lib/api';
import { showToast } from './Toast';
import { log } from '../lib/logger';
import './NewDayNotification.css';

interface NewDayNotificationProps {
  clubDayId: string | null;
  onDismiss: () => void;
}

const LAST_SEEN_DAY_KEY = 'last-seen-club-day-id';
const TOAST_SHOWN_KEY = 'new-day-toast-shown';

export default function NewDayNotification({ clubDayId, onDismiss }: NewDayNotificationProps) {
  const [showNotification, setShowNotification] = useState(false);
  const [doorFeeCount, setDoorFeeCount] = useState<number | null>(null);
  const [doorFeeTotal, setDoorFeeTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const toastShownRef = useRef(false);

  useEffect(() => {
    if (!clubDayId) {
      setLoading(false);
      return;
    }

    // Check if this is a new day
    const lastSeenDayId = localStorage.getItem(LAST_SEEN_DAY_KEY);
    const isNewDay = lastSeenDayId !== clubDayId;

    if (isNewDay) {
      // New day detected - show notification
      setShowNotification(true);
      localStorage.setItem(LAST_SEEN_DAY_KEY, clubDayId);
      
      // Show toast notification only once per session
      const toastShown = sessionStorage.getItem(TOAST_SHOWN_KEY);
      if (!toastShown && !toastShownRef.current) {
        showToast('🆕 New Club Day Started! All door fees are now tracked for this new day.', 'info', 10000);
        sessionStorage.setItem(TOAST_SHOWN_KEY, clubDayId);
        toastShownRef.current = true;
      }
      
      // Load door fee stats for the new day
      loadDoorFeeStats();
    } else {
      // Same day - just load stats
      loadDoorFeeStats();
    }
  }, [clubDayId]);

  // Auto-dismiss notification after 5 seconds
  useEffect(() => {
    if (!showNotification) return;

    const autoDismissTimer = setTimeout(() => {
      setShowNotification(false);
      onDismiss();
    }, 5000); // 5 seconds

    return () => clearTimeout(autoDismissTimer);
  }, [showNotification, onDismiss]);

  const loadDoorFeeStats = async () => {
    if (!clubDayId) return;
    
    try {
      setLoading(true);
      const report = await getClubDayReport(clubDayId);
      setDoorFeeCount(report.checkin_count || 0);
      setDoorFeeTotal(report.total_door_fees || 0);
    } catch (error) {
      log('Error loading door fee stats:', error);
      // Fallback: just get check-in count
      try {
        const checkIns = await getCheckInsForClubDay(clubDayId);
        setDoorFeeCount(checkIns.length);
        setDoorFeeTotal(checkIns.reduce((sum, ci) => sum + ci.door_fee_amount, 0));
      } catch (err) {
        log('Error loading check-ins:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!showNotification || !clubDayId) {
    return null;
  }

  return (
    <div className="new-day-notification">
      <div className="new-day-content">
        <div className="new-day-icon">🆕</div>
        <div className="new-day-text">
          <div className="new-day-title">New Club Day Started</div>
          <div className="new-day-subtitle">
            All door fees are now tracked separately for this new day.
            {loading ? (
              <span className="new-day-stats-loading">Loading stats...</span>
            ) : (
              <span className="new-day-stats">
                {doorFeeCount !== null && (
                  <>
                    <strong>{doorFeeCount}</strong> check-in{doorFeeCount !== 1 ? 's' : ''} • 
                    ${doorFeeTotal !== null ? doorFeeTotal.toFixed(2) : '0.00'} collected
                  </>
                )}
              </span>
            )}
          </div>
        </div>
        <button 
          className="new-day-dismiss" 
          onClick={() => {
            setShowNotification(false);
            onDismiss();
          }}
          title="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}
