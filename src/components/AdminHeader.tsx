import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { signOut } from 'aws-amplify/auth';
import type { ClubDay } from '../types';
import Logo from './Logo';
import Tooltip from './Tooltip';
import './AdminHeader.css';

interface AdminHeaderProps {
  clubDay: ClubDay | null;
  onCheckIn: () => void;
  onRefund: () => void;
  onAddTable: () => void;
  onReports: () => void;
  onOpenTV: () => void;
  onTableManagement: () => void;
  onResetDay: () => void;
  onFixDoubleSeating: () => void;
  onPlayerManagement: () => void;
  onShowTutorial: () => void;
  onShowKnowledgeBase: () => void;
  onBulkAddTestPlayers?: () => void;
  onShowQRCode?: () => void;
  onPurgeOldPlayers?: () => void;
  onRecoverState?: () => void;
  onCashRecon?: () => void;
  onSMSSettings?: () => void;
  onHighHand?: () => void;
}

export default function AdminHeader(props: AdminHeaderProps) {
  const {
    onCheckIn,
    onRefund,
    onAddTable,
    onReports,
    onOpenTV,
    onTableManagement,
    onResetDay,
    onFixDoubleSeating,
    onPlayerManagement,
    onShowTutorial,
    onShowKnowledgeBase,
    onBulkAddTestPlayers,
    onShowQRCode,
    onPurgeOldPlayers,
    onRecoverState,
    onCashRecon,
    onSMSSettings,
    onHighHand,
  } = props;
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showManagementMenu, setShowManagementMenu] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Close management menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.management-dropdown')) {
        setShowManagementMenu(false);
      }
    };

    if (showManagementMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showManagementMenu]);

  const handleLogout = async () => {
    await signOut();
    window.location.href = '/login';
  };

  return (
    <header className="admin-header">
      <div className="header-content">
        {/* Left: logo + datetime — stays fixed */}
        <div className="header-left">
          <div className="header-logo">
            <Logo />
          </div>
          <div className="header-datetime">
            {format(currentTime, 'EEE, MMM d • h:mm a')}
          </div>
        </div>

        {/* Center: all action buttons */}
        <div className="header-center">
          <div className="header-actions">
            {/* Primary Actions Group */}
            <div className="action-group action-group-primary">
              <span className="action-group-label">Player Actions</span>
              <div className="action-group-buttons">
                <Tooltip content="Check in a new player (Ctrl+B)">
                  <button className="btn-primary" onClick={onCheckIn}>
                    Buy-in Player
                  </button>
                </Tooltip>
                <Tooltip content="Refund a player's buy-in (Ctrl+R)">
                  <button className="btn-secondary btn-refund" onClick={onRefund}>
                    Refund
                  </button>
                </Tooltip>
                {onHighHand && (
                  <Tooltip content="Manage hourly high hand promotion">
                    <button className="btn-secondary btn-high-hand" onClick={onHighHand}>
                      🃏 High Hand
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            <div className="action-divider" />

            {/* Table Operations Group */}
            <div className="action-group">
              <span className="action-group-label">Tables</span>
              <div className="action-group-buttons">
                <Tooltip content="Add a new table to the game (Ctrl+T)">
                  <button className="btn-secondary" onClick={onAddTable}>
                    ➕ Add Table
                  </button>
                </Tooltip>
                <Tooltip content="Manage table settings and configurations">
                  <button className="btn-secondary" onClick={onTableManagement}>
                    ⚙️ Manage
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="action-divider" />

            {/* Views Group — QR Code moved to Settings dropdown */}
            <div className="action-group">
              <span className="action-group-label">Display</span>
              <div className="action-group-buttons">
                <Tooltip content="Open tablet interface for player movement">
                  <button
                    className="btn-secondary"
                    onClick={() => window.open('/tablet', '_blank')}
                  >
                    📱 Tablet
                  </button>
                </Tooltip>
                <Tooltip content="Open TV display in a new window">
                  <button className="btn-secondary btn-cast-tv" onClick={onOpenTV}>
                    📺 TV
                  </button>
                </Tooltip>
                <Tooltip content="Open mobile view in a new window">
                  <button
                    className="btn-secondary"
                    onClick={() => window.open('/public', '_blank')}
                  >
                    📱 Mobile View
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="action-divider" />

            {/* Settings dropdown — Reports and QR Code added here */}
            <div className="management-dropdown">
              <button
                ref={moreButtonRef}
                className="btn-secondary management-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showManagementMenu && moreButtonRef.current) {
                    const rect = moreButtonRef.current.getBoundingClientRect();
                    setMenuPos({ top: rect.bottom + 6, left: rect.left });
                  }
                  setShowManagementMenu(!showManagementMenu);
                }}
              >
                🛠️ Settings
                <span className={`dropdown-arrow ${showManagementMenu ? 'open' : ''}`}>▼</span>
              </button>
              {showManagementMenu && menuPos && (
                <div className="management-menu" style={{ top: menuPos.top, left: menuPos.left }}>
                  <button className="management-menu-item" onClick={() => { onReports(); setShowManagementMenu(false); }}>
                    📊 Reports
                  </button>
                  {onShowQRCode && (
                    <button className="management-menu-item" onClick={() => { onShowQRCode!(); setShowManagementMenu(false); }}>
                      📷 QR Code
                    </button>
                  )}
                  <div className="management-menu-separator"></div>
                  <button className="management-menu-item" onClick={() => { onPlayerManagement(); setShowManagementMenu(false); }}>
                    👥 Player Management
                  </button>
                  {onSMSSettings && (
                    <button className="management-menu-item" onClick={() => { onSMSSettings!(); setShowManagementMenu(false); }}>
                      📱 SMS Settings
                    </button>
                  )}
                  <button className="management-menu-item" onClick={() => { onShowKnowledgeBase(); setShowManagementMenu(false); }}>
                    📖 Knowledge Base
                  </button>
                  {onCashRecon && (
                    <button className="management-menu-item" onClick={() => { onCashRecon!(); setShowManagementMenu(false); }}>
                      💰 Cash Reconciliation
                    </button>
                  )}
                  <button className="management-menu-item" onClick={() => {
                    const pw = prompt('Enter password to access Reset Day:');
                    if (pw === 'finaltableboss') {
                      onResetDay();
                      setShowManagementMenu(false);
                    } else if (pw !== null) {
                      alert('Incorrect password');
                    }
                  }}>
                    🔁 Reset Day
                  </button>
                  <div className="management-menu-separator"></div>
                  <div className="management-menu-section-header">Admin Tools</div>
                  {onBulkAddTestPlayers && (
                    <button className="management-menu-item" onClick={() => { onBulkAddTestPlayers!(); setShowManagementMenu(false); }}>
                      Add Test Players
                    </button>
                  )}
                  <button className="management-menu-item management-menu-item-danger" onClick={() => { onFixDoubleSeating(); setShowManagementMenu(false); }}>
                    Fix Double-Seating
                  </button>
                  {onRecoverState && (
                    <button className="management-menu-item" onClick={() => { onRecoverState!(); setShowManagementMenu(false); }}>
                      🔄 Restore State (last 1hr)
                    </button>
                  )}
                  {onPurgeOldPlayers && (
                    <button className="management-menu-item management-menu-item-danger" onClick={() => { onPurgeOldPlayers!(); setShowManagementMenu(false); }}>
                      🗑️ Purge Old Players (90d)
                    </button>
                  )}
                  <div className="management-menu-separator"></div>
                  <button className="management-menu-item" onClick={() => { onShowTutorial(); setShowManagementMenu(false); }}>
                    ❓ Help / Tutorial
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: logout only */}
        <div className="header-right">
          <Tooltip content="Sign out of your account">
            <button className="btn-secondary btn-logout" onClick={handleLogout}>
              🚪
            </button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
