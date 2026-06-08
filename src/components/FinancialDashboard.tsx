import { useState, useEffect } from 'react';
import { getActiveClubDay, getClubDayReport, getEndOfShiftReport } from '../lib/api';
import { getAWSStats, getAppSyncStats, type AWSStats } from '../lib/awsStats';
import { format } from 'date-fns';
import './FinancialDashboard.css';

interface FinancialDashboardProps {
  onClose: () => void;
  adminUser?: string;
}

interface DoorFeeBreakdownItem {
  amount: number;
  count: number;
  total: number;
}

interface FinancialData {
  totalDoorFees: number;
  totalRefunds: number;
  netTotal: number;
  checkinCount: number;
  activeCheckinCount: number;
  refundCount: number;
  doorFeeBreakdown: DoorFeeBreakdownItem[];
  recentCheckins: Array<{
    name: string;
    amount: number;
    time: string;
    paymentMethod: string;
  }>;
  recentRefunds: Array<{
    name: string;
    amount: number;
    reason: string;
    time: string;
  }>;
  paymentMethodBreakdown: Record<string, number>;
  hourlyStats: Array<{
    hour: string;
    checkins: number;
    refunds: number;
    net: number;
  }>;
  clubDay?: {
    id: string;
    started_at: string;
    status: string;
  };
  rangeLabel?: string;
}

const safeFormat = (dateStr: string | undefined | null, fmt: string, fallback = '—'): string => {
  if (!dateStr) return fallback;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return fallback;
    return format(d, fmt);
  } catch {
    return fallback;
  }
};

export default function FinancialDashboard({ onClose, adminUser }: FinancialDashboardProps) {
  const [data, setData] = useState<FinancialData | null>(null);
  const [awsStats, setAwsStats] = useState<AWSStats | null>(null);
  const [appSyncStats, setAppSyncStats] = useState<{ estimatedQueriesToday: number; estimatedMutationsToday: number; totalOperations: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [timeRange, setTimeRange] = useState<'current' | 'custom'>('current');
  // Custom date range — separate date and time fields for clarity
  const [rangeStartDate, setRangeStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rangeStartTime, setRangeStartTime] = useState('00:00');
  const [rangeEndDate, setRangeEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rangeEndTime, setRangeEndTime] = useState('23:59');
  const [activeTab, setActiveTab] = useState<'financial' | 'aws'>('financial');

  const fetchData = async () => {
    try {
      let reportData;
      let clubDay: any = null;
      let rangeLabel: string | undefined;

      if (timeRange === 'custom') {
        // Custom date range: query ALL check-ins in window, NO club day scoping
        const startISO = new Date(`${rangeStartDate}T${rangeStartTime}`).toISOString();
        const endISO = new Date(`${rangeEndDate}T${rangeEndTime}`).toISOString();
        reportData = await getEndOfShiftReport(startISO, endISO, null);
        rangeLabel = `${rangeStartDate} ${rangeStartTime} — ${rangeEndDate} ${rangeEndTime}`;
      } else {
        // Current club day
        const activeDay = await getActiveClubDay();
        if (!activeDay) {
          setData(null);
          setLoading(false);
          return;
        }
        clubDay = activeDay;
        reportData = await getClubDayReport(activeDay.id);
      }

      // Process payment method breakdown from ALL check-ins (matches gross total)
      const paymentMethodBreakdown: Record<string, number> = {};
      (reportData.checkIns || []).forEach((checkin: any) => {
        const method = checkin.payment_method || 'Unknown';
        paymentMethodBreakdown[method] = (paymentMethodBreakdown[method] || 0) + checkin.door_fee_amount;
      });

      // Process hourly stats
      const hourlyMap = new Map<string, { checkins: number; refunds: number }>();

      (reportData.checkIns || []).forEach((checkin: any) => {
        const hour = safeFormat(checkin.checkin_time, 'ha', '??');
        const existing = hourlyMap.get(hour) || { checkins: 0, refunds: 0 };
        hourlyMap.set(hour, {
          checkins: existing.checkins + checkin.door_fee_amount,
          refunds: existing.refunds
        });
      });

      (reportData.refunds || []).forEach((refund: any) => {
        const hour = safeFormat(refund.refunded_at || refund.createdAt, 'ha', '??');
        const existing = hourlyMap.get(hour) || { checkins: 0, refunds: 0 };
        hourlyMap.set(hour, {
          checkins: existing.checkins,
          refunds: existing.refunds + refund.amount
        });
      });

      const hourlyStats: Array<{ hour: string; checkins: number; refunds: number; net: number }> = [];
      hourlyMap.forEach((value, hour) => {
        hourlyStats.push({
          hour,
          checkins: value.checkins,
          refunds: value.refunds,
          net: value.checkins - value.refunds
        });
      });
      hourlyStats.sort((a, b) => a.hour.localeCompare(b.hour));

      const processedData: FinancialData = {
        totalDoorFees: reportData.total_door_fees || 0,
        totalRefunds: reportData.total_refunds || 0,
        netTotal: reportData.net_total || 0,
        checkinCount: reportData.checkin_count || 0,
        activeCheckinCount: reportData.active_checkin_count || 0,
        refundCount: reportData.refund_count || 0,
        doorFeeBreakdown: reportData.doorFeeBreakdown || [],
        recentCheckins: (reportData.checkedInNames || []).slice(-10).reverse(),
        recentRefunds: (reportData.refundedNames || []).slice(-10).reverse(),
        paymentMethodBreakdown,
        hourlyStats,
        clubDay,
        rangeLabel,
      };

      setData(processedData);
    } catch (error: any) {
      console.error('Error fetching financial data:', error);
    } finally {
      setLoading(false);
    }
    
    // Fetch AWS stats separately so they don't block the dashboard
    try {
      const [awsData, appSyncData] = await Promise.allSettled([
        getAWSStats(),
        getAppSyncStats(),
      ]);
      
      if (awsData.status === 'fulfilled') {
        setAwsStats(awsData.value);
      }
      if (appSyncData.status === 'fulfilled') {
        setAppSyncStats(appSyncData.value);
      }
    } catch (error: any) {
      console.error('Error fetching AWS stats:', error);
    }
  };

  // Auto-fetch on mount and when switching to "current" mode
  useEffect(() => {
    if (timeRange === 'current') {
      fetchData();
    }
  }, [timeRange]);

  // Auto-refresh only in "current" mode
  useEffect(() => {
    if (!autoRefresh || timeRange !== 'current') return;
    const interval = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, timeRange]);

  // Handle mode switch — reset auto-refresh state
  const handleTimeRangeChange = (mode: 'current' | 'custom') => {
    setTimeRange(mode);
    if (mode === 'custom') {
      setAutoRefresh(false);
    } else {
      setAutoRefresh(true);
    }
  };

  // Run custom date range report
  const handleRunCustomReport = () => {
    setLoading(true);
    setData(null);
    fetchData();
  };

  if (loading) {
    return (
      <div className="financial-dashboard-modal">
        <div className="financial-dashboard-content">
          <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
            <h2 style={{ margin: 0 }}>Operations Dashboard</h2>
            <button onClick={onClose} className="close-button" style={{ fontSize: '24px', padding: '4px 12px', cursor: 'pointer', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px' }}>✕</button>
          </div>
          <div className="loading">Loading dashboard data...</div>
        </div>
      </div>
    );
  }

  if (!data && timeRange === 'current') {
    return (
      <div className="financial-dashboard-modal">
        <div className="financial-dashboard-content">
          <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Operations Dashboard</h2>
            <button onClick={onClose} className="dashboard-close-btn">✕ Close</button>
          </div>
          <div className="dashboard-controls">
            <div className="mode-selector">
              <button className="mode-btn active">Current Club Day</button>
              <button className="mode-btn" onClick={() => handleTimeRangeChange('custom')}>Custom Date Range</button>
            </div>
          </div>
          <div className="no-data">No active club day found. Try using Custom Date Range to view historical data.</div>
        </div>
      </div>
    );
  }

  const breakdownTotal = data?.doorFeeBreakdown?.reduce((s, b) => s + b.total, 0) || 0;

  return (
    <div className="financial-dashboard-modal">
      <div className="financial-dashboard-content">
        {/* ─── Header Row: Title + Tabs + Close ─── */}
        <div className="dashboard-header">
          <div className="dashboard-title">
            <h2>Operations Dashboard</h2>
            <div className="dashboard-tabs">
              <button 
                className={`tab-button ${activeTab === 'financial' ? 'active' : ''}`}
                onClick={() => setActiveTab('financial')}
              >
                Financial
              </button>
              <button 
                className={`tab-button ${activeTab === 'aws' ? 'active' : ''}`}
                onClick={() => setActiveTab('aws')}
              >
                AWS Backend
              </button>
            </div>
          </div>
          <button onClick={onClose} className="dashboard-close-btn">✕ Close</button>
        </div>

        {/* ─── Controls Row: Mode selector + Date Range + Refresh ─── */}
        <div className="dashboard-controls">
          <div className="mode-selector">
            <button
              className={`mode-btn ${timeRange === 'current' ? 'active' : ''}`}
              onClick={() => handleTimeRangeChange('current')}
            >
              Current Club Day
            </button>
            <button
              className={`mode-btn ${timeRange === 'custom' ? 'active' : ''}`}
              onClick={() => handleTimeRangeChange('custom')}
            >
              Custom Date Range
            </button>
          </div>

          {timeRange === 'custom' && (
            <div className="date-range-controls">
              <div className="date-range-row">
                <label className="range-label">From:</label>
                <input type="date" value={rangeStartDate} onChange={(e) => setRangeStartDate(e.target.value)} className="date-input" />
                <input type="time" value={rangeStartTime} onChange={(e) => setRangeStartTime(e.target.value)} className="time-input" />
                <label className="range-label">To:</label>
                <input type="date" value={rangeEndDate} onChange={(e) => setRangeEndDate(e.target.value)} className="date-input" />
                <input type="time" value={rangeEndTime} onChange={(e) => setRangeEndTime(e.target.value)} className="time-input" />
                <button onClick={handleRunCustomReport} className="run-report-btn">Run Report</button>
              </div>
            </div>
          )}

          {timeRange === 'current' && (
            <div className="refresh-controls">
              <label className="auto-refresh-toggle">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh
              </label>
              {autoRefresh && (
                <select 
                  value={refreshInterval} 
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="refresh-interval-select"
                >
                  <option value={10}>10s</option>
                  <option value={30}>30s</option>
                  <option value={60}>1m</option>
                  <option value={300}>5m</option>
                </select>
              )}
              <button onClick={fetchData} className="refresh-button">Refresh Now</button>
            </div>
          )}
        </div>

        {activeTab === 'financial' && data && (
          <>
            {/* ─── Context Bar ─── */}
            <div className="club-day-info">
              {timeRange === 'current' && data.clubDay ? (
                <>
                  <span>Club Day: {safeFormat(data.clubDay.started_at, 'MMM d, yyyy h:mm a')}</span>
                  <span className={`status ${data.clubDay.status}`}>{data.clubDay.status}</span>
                </>
              ) : data.rangeLabel ? (
                <span>Date Range: {data.rangeLabel}</span>
              ) : null}
            </div>

            {/* ─── Top Metrics ─── */}
            <div className="metrics-grid">
              <div className="metric-card primary">
                <div className="metric-value">${data.totalDoorFees.toFixed(2)}</div>
                <div className="metric-label">Total Door Fees (Gross)</div>
                <div className="metric-sub">{data.checkinCount} total check-ins</div>
              </div>
              
              <div className="metric-card danger">
                <div className="metric-value">${data.totalRefunds.toFixed(2)}</div>
                <div className="metric-label">Total Refunds</div>
                <div className="metric-sub">{data.refundCount} refunds</div>
              </div>
              
              <div className="metric-card success">
                <div className="metric-value">${data.netTotal.toFixed(2)}</div>
                <div className="metric-label">Net Total</div>
                <div className="metric-sub">{data.activeCheckinCount} active check-ins</div>
              </div>
              
              <div className="metric-card">
                <div className="metric-value">
                  {data.totalDoorFees > 0 ? ((data.totalRefunds / data.totalDoorFees) * 100).toFixed(1) : '0.0'}%
                </div>
                <div className="metric-label">Refund Rate</div>
                <div className="metric-sub">of gross door fees</div>
              </div>
            </div>

            {/* ─── Door Fee Breakdown (THE MATH) ─── */}
            {data.doorFeeBreakdown && data.doorFeeBreakdown.length > 0 && (
              <div className="fee-breakdown-section">
                <h3>Door Fee Breakdown (Active Buy-ins)</h3>
                <div className="fee-breakdown-table">
                  <div className="fee-breakdown-header">
                    <span>Fee Amount</span>
                    <span>Count</span>
                    <span>Subtotal</span>
                  </div>
                  {data.doorFeeBreakdown.map((item, i) => (
                    <div key={i} className="fee-breakdown-row">
                      <span className="fee-amount">${item.amount.toFixed(2)}</span>
                      <span className="fee-count">× {item.count}</span>
                      <span className="fee-subtotal">${item.total.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="fee-breakdown-row fee-breakdown-total">
                    <span>GROSS TOTAL</span>
                    <span></span>
                    <span className="fee-subtotal">${breakdownTotal.toFixed(2)}</span>
                  </div>
                  {data.totalRefunds > 0 && (
                    <div className="fee-breakdown-row fee-breakdown-refund">
                      <span>Less Refunds</span>
                      <span></span>
                      <span className="fee-subtotal">−${data.totalRefunds.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="fee-breakdown-row fee-breakdown-net">
                    <span>NET TOTAL</span>
                    <span></span>
                    <span className="fee-subtotal">${data.netTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="dashboard-grid">
              <div className="dashboard-section">
                <h3>Payment Methods</h3>
                <div className="payment-methods">
                  {Object.entries(data.paymentMethodBreakdown).map(([method, amount]) => (
                    <div key={method} className="payment-method-item">
                      <span className="method-name">{method}</span>
                      <span className="method-amount">${amount.toFixed(2)}</span>
                      <span className="method-percent">
                        {data.totalDoorFees > 0 ? ((amount / data.totalDoorFees) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dashboard-section">
                <h3>Hourly Breakdown</h3>
                <div className="hourly-stats">
                  {data.hourlyStats.map((stat) => (
                    <div key={stat.hour} className="hourly-item">
                      <span className="hour">{stat.hour}</span>
                      <span className="checkins">+${stat.checkins}</span>
                      <span className="refunds">-${stat.refunds}</span>
                      <span className={`net ${stat.net >= 0 ? 'positive' : 'negative'}`}>
                        ${stat.net.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-section">
                <h3>Recent Check-ins (Last 10)</h3>
                <div className="recent-activity">
                  {data.recentCheckins.map((checkin, index) => (
                    <div key={index} className="activity-item checkin">
                      <span className="name">{checkin.name}</span>
                      <span className="amount">${checkin.amount}</span>
                      <span className="method">{checkin.paymentMethod}</span>
                      <span className="time">{safeFormat(checkin.time, 'h:mm a')}</span>
                    </div>
                  ))}
                  {data.recentCheckins.length === 0 && (
                    <div className="no-activity">No check-ins yet</div>
                  )}
                </div>
              </div>

              <div className="dashboard-section">
                <h3>Recent Refunds (Last 10)</h3>
                <div className="recent-activity">
                  {data.recentRefunds.map((refund, index) => (
                    <div key={index} className="activity-item refund">
                      <span className="name">{refund.name}</span>
                      <span className="amount">-${refund.amount}</span>
                      <span className="reason" title={refund.reason}>
                        {refund.reason.length > 20 ? refund.reason.substring(0, 20) + '...' : refund.reason}
                      </span>
                      <span className="time">{safeFormat(refund.time, 'h:mm a')}</span>
                    </div>
                  ))}
                  {data.recentRefunds.length === 0 && (
                    <div className="no-activity">No refunds yet</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'aws' && (
          <div className="aws-stats-section">
            {awsStats && (() => {
              const approx = new Set(awsStats.approximateCounts || []);
              const fmt = (model: string, val: number) => approx.has(model) ? `${val.toLocaleString()}+` : val.toLocaleString();
              return (
              <>
                <div className="aws-stats-grid">
                  <div className="metric-card primary">
                    <div className="metric-value">{fmt('Player', awsStats.totalPlayers)}</div>
                    <div className="metric-label">Total Players</div>
                    <div className="metric-sub">In database</div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-value">{fmt('ClubDay', awsStats.totalClubDays)}</div>
                    <div className="metric-label">Club Days</div>
                    <div className="metric-sub">Historical</div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-value">{fmt('PokerTable', awsStats.totalTables)}</div>
                    <div className="metric-label">Total Tables</div>
                    <div className="metric-sub">All time</div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-value">{fmt('CheckIn', awsStats.totalCheckIns)}</div>
                    <div className="metric-label">Total Check-ins</div>
                    <div className="metric-sub">All time</div>
                  </div>
                </div>

                <div className="aws-stats-grid">
                  <div className="metric-card danger">
                    <div className="metric-value">{fmt('Refund', awsStats.totalRefunds)}</div>
                    <div className="metric-label">Total Refunds</div>
                    <div className="metric-sub">All time</div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-value">{fmt('TableSeat', awsStats.totalTableSeats)}</div>
                    <div className="metric-label">Table Seats</div>
                    <div className="metric-sub">Total records</div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-value">{fmt('TableWaitlist', awsStats.totalTableWaitlists)}</div>
                    <div className="metric-label">Waitlist Entries</div>
                    <div className="metric-sub">Total records</div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-value">{fmt('LedgerEntry', awsStats.totalLedgerEntries)}</div>
                    <div className="metric-label">Ledger Entries</div>
                    <div className="metric-sub">Financial records</div>
                  </div>
                </div>

                <div className="dashboard-grid">
                  <div className="dashboard-section">
                    <h3>Storage & Costs</h3>
                    <div className="storage-stats">
                      <div className="storage-item">
                        <span className="storage-label">Estimated DB Size:</span>
                        <span className="storage-value">{awsStats.storageSize || 'Calculating...'}</span>
                      </div>
                      <div className="storage-item">
                        <span className="storage-label">Est. Monthly Cost:</span>
                        <span className="storage-value">{awsStats.estimatedMonthlyCost || 'Calculating...'}</span>
                      </div>
                      {awsStats.lastClubDay && (
                        <div className="storage-item">
                          <span className="storage-label">Last Club Day:</span>
                          <span className="storage-value">{safeFormat(awsStats.lastClubDay, 'MMM d, yyyy')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="dashboard-section">
                    <h3>AppSync Usage (Today)</h3>
                    <div className="appsync-stats">
                      {appSyncStats ? (
                        <>
                          <div className="appsync-item">
                            <span className="appsync-label">Queries:</span>
                            <span className="appsync-value">{appSyncStats.estimatedQueriesToday.toLocaleString()}</span>
                          </div>
                          <div className="appsync-item">
                            <span className="appsync-label">Mutations:</span>
                            <span className="appsync-value">{appSyncStats.estimatedMutationsToday.toLocaleString()}</span>
                          </div>
                          <div className="appsync-item">
                            <span className="appsync-label">Total Operations:</span>
                            <span className="appsync-value">{appSyncStats.totalOperations.toLocaleString()}</span>
                          </div>
                        </>
                      ) : (
                        <div className="no-activity">Loading AppSync stats...</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="dashboard-section">
                  <h3>Database Record Counts</h3>
                  <div className="record-counts">
                    <div className="record-item">
                      <span className="record-name">Audit Logs</span>
                      <span className="record-count">{awsStats.totalAuditLogs.toLocaleString()}</span>
                    </div>
                    <div className="record-item">
                      <span className="record-name">Receipts</span>
                      <span className="record-count">{awsStats.totalReceipts.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </>
              );
            })()}
            
            {!awsStats && (
              <div className="loading-aws">
                <div className="loading">Loading AWS backend stats...</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
