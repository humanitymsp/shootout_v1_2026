import { useState } from 'react';
import './KnowledgeBaseModal.css';

interface KnowledgeBaseModalProps {
  onClose: () => void;
}

export default function KnowledgeBaseModal({ onClose }: KnowledgeBaseModalProps) {
  const [activeTopic, setActiveTopic] = useState<'reset' | 'routes'>('reset');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content knowledge-base-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Knowledge Base</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="kb-tabs">
          <button 
            className={activeTopic === 'reset' ? 'active' : ''} 
            onClick={() => setActiveTopic('reset')}
          >
            Day Reset Process
          </button>
          <button 
            className={activeTopic === 'routes' ? 'active' : ''} 
            onClick={() => setActiveTopic('routes')}
          >
            Tablet & Public Routes
          </button>
        </div>

        <div className="kb-content">
          {activeTopic === 'reset' && (
            <>
              <div className="kb-topic">
            <h4>How Day Reset Works</h4>
            <p>When you reset or close a day, the system performs the following actions:</p>
            <ul>
              <li><strong>Closes the current ClubDay</strong> - Sets status to 'closed' and records the end time</li>
              <li><strong>Marks all seats as left</strong> - All players are marked as having left their tables</li>
              <li><strong>Clears all waitlists</strong> - All waitlist entries are marked as removed</li>
              <li><strong>Closes all tables</strong> - All tables are set to 'CLOSED' status</li>
              <li><strong>Creates a new ClubDay</strong> - Starts a fresh day with new ID</li>
              <li><strong>Auto-creates default tables</strong> - Creates tables 8, 10, and 14 with preserved buy-in limits</li>
            </ul>
          </div>

          <div className="kb-topic">
            <h4>Ways to Reset/Close a Day</h4>
            <ol>
              <li>
                <strong>End of Day Report (Recommended):</strong>
                <ul>
                  <li>Click <strong>"Reports"</strong> in the admin header</li>
                  <li>Select <strong>"Current Day"</strong> report type</li>
                  <li>Click <strong>"Generate Report &amp; Close Day"</strong></li>
                  <li>The EOD report prints automatically, then the day is closed and a new one starts</li>
                </ul>
              </li>
              <li>
                <strong>Manual Reset:</strong> Click "Reset Day" button → Confirm → Day is reset immediately (no report generated)
              </li>
              <li>
                <strong>Cash Reconciliation:</strong>
                <ul>
                  <li>Open "Cash Reconciliation" from the header</li>
                  <li>Enter the counted cash amount</li>
                  <li>Check the box: "Close day and start new day after recording cash count"</li>
                  <li>Click "Record Count &amp; Close Day"</li>
                </ul>
              </li>
              <li>
                <strong>Auto-Reset:</strong> System automatically resets at 9:00am if no active players are seated or waitlisted
              </li>
            </ol>
          </div>

          <div className="kb-topic">
            <h4>Important Notes</h4>
            <ul>
              <li><strong>Day reset cannot be undone</strong> - All data from the previous day is preserved but the day is marked as closed</li>
              <li><strong>Previous day's data is preserved</strong> - Check-ins, receipts, and ledger entries remain tied to the closed day</li>
              <li><strong>New day starts fresh</strong> - Players must check in again for the new day</li>
              <li><strong>Buy-in limits are preserved</strong> - Table buy-in limits from the previous day are carried over to default tables</li>
              <li><strong>Auto-reset safety</strong> - Auto-reset at 9am only runs if there are no active players (prevents accidental resets during active play)</li>
            </ul>
          </div>

          <div className="kb-topic">
            <h4>Recommended End-of-Day Process</h4>
            <ol>
              <li>Ensure all players are cashed out and seated/waitlist entries are cleared</li>
              <li>Click <strong>"Reports"</strong> in the admin header</li>
              <li>Confirm <strong>"Current Day"</strong> is selected</li>
              <li>Click <strong>"Generate Report &amp; Close Day"</strong></li>
              <li>The EOD report will open in a print window — print or save as needed</li>
              <li>The system automatically closes the current day and starts a new one</li>
              <li>Default tables (8, 10, 14) are recreated with preserved buy-in limits</li>
              <li>New day is ready for the next session</li>
            </ol>
            <p style={{marginTop: '0.5rem', color: 'var(--admin-muted)', fontSize: '0.85rem'}}>
              <strong>Note:</strong> The "Close Day &amp; Start New Day" button in the Reports modal performs the EOD reset immediately after the report is generated — no separate step needed.
            </p>
          </div>
            </>
          )}

          {activeTopic === 'routes' && (
            <>
              <div className="kb-topic">
                <h4>Tablet Management Route (`/tablet`)</h4>
                <p>Full-featured tablet interface for managing player movements between tables.</p>
                <ul>
                  <li><strong>URL:</strong> <code>https://yoursite.com/tablet</code></li>
                  <li><strong>Access:</strong> Click "📱 Tablet View" button in admin header (opens in new window) or navigate directly</li>
                  <li><strong>Features:</strong> View all tables, select players, move between tables/seats/waitlists</li>
                  <li><strong>Authentication:</strong> Optional - works without login (uses 'admin' as default)</li>
                  <li><strong>Use Cases:</strong> Floor staff tablets, quick access without admin navigation</li>
                </ul>
              </div>

              <div className="kb-topic">
                <h4>Public Viewing Route (`/public`)</h4>
                <p>Public-facing view of table status for players to check availability on their mobile devices.</p>
                <ul>
                  <li><strong>URL:</strong> <code>https://yoursite.com/public</code></li>
                  <li><strong>Access:</strong> Click "Public Link" button in admin header (copies URL to clipboard) or navigate directly</li>
                  <li><strong>Features:</strong> View table status, seated/open/waitlist counts, buy-in limits, bomb pots</li>
                  <li><strong>Authentication:</strong> Not required - fully public</li>
                  <li><strong>Use Cases:</strong> Share with players via text/email/QR code, display on TV screens</li>
                </ul>
              </div>

              <div className="kb-topic">
                <h4>How to Get Public Link</h4>
                <ol>
                  <li>Log into admin page</li>
                  <li>Click "Public Link" button in header</li>
                  <li>URL is automatically copied to clipboard</li>
                  <li>Share the URL: <code>https://yoursite.com/public</code></li>
                  <li>Consider generating a QR code for easy access</li>
                </ol>
              </div>

              <div className="kb-topic">
                <h4>Key Benefits</h4>
                <ul>
                  <li><strong>Direct URLs</strong> - Can be bookmarked and shared</li>
                  <li><strong>Multiple instances</strong> - Can open multiple tablet/public views simultaneously</li>
                  <li><strong>Independent</strong> - Don't require admin page to be open</li>
                  <li><strong>Real-time updates</strong> - Sync automatically with admin changes</li>
                  <li><strong>Mobile optimized</strong> - Public page works great on phones</li>
                </ul>
              </div>

              <div className="kb-topic">
                <h4>Best Practices</h4>
                <ul>
                  <li><strong>Tablet View:</strong> Bookmark `/tablet` on dedicated tablets, use full-screen mode</li>
                  <li><strong>Public Link:</strong> Generate QR code, share on social media, display at entrance</li>
                  <li><strong>Both:</strong> Ensure active club day exists, check internet connection if not loading</li>
                </ul>
              </div>

              <div className="kb-topic">
                <h4>For More Details</h4>
                <p>See <code>docs/TABLET_AND_PUBLIC_ROUTES.md</code> for comprehensive documentation.</p>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
