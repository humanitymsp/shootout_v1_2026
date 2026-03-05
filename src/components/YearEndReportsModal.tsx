import { useState, useEffect } from 'react';
import { generateYearEndReport, exportYearEndReportToCSV, exportYearEndReportToHTML, getAvailableReportYears, type YearEndReport } from '../lib/yearEndReports';
import { showToast } from './Toast';
import { format } from 'date-fns';
import './YearEndReportsModal.css';

interface YearEndReportsModalProps {
  onClose: () => void;
}

export default function YearEndReportsModal({ onClose }: YearEndReportsModalProps) {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [report, setReport] = useState<YearEndReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'html'>('html');

  useEffect(() => {
    loadAvailableYears();
  }, []);

  const loadAvailableYears = async () => {
    try {
      const years = await getAvailableReportYears();
      setAvailableYears(years);
      if (years.length > 0 && !years.includes(selectedYear)) {
        setSelectedYear(years[0]);
      }
    } catch (error) {
      console.error('Failed to load available years:', error);
      showToast('Failed to load available years', 'error');
    }
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const reportData = await generateYearEndReport(selectedYear);
      setReport(reportData);
      showToast(`Year-end report for ${selectedYear} generated successfully`, 'success');
    } catch (error: any) {
      console.error('Failed to generate report:', error);
      showToast(error.message || 'Failed to generate report', 'error');
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!report) return;

    try {
      let content: string;
      let filename: string;
      let mimeType: string;

      if (exportFormat === 'csv') {
        content = exportYearEndReportToCSV(report);
        filename = `year-end-report-${report.year}.csv`;
        mimeType = 'text/csv';
      } else {
        content = exportYearEndReportToHTML(report);
        filename = `year-end-report-${report.year}.html`;
        mimeType = 'text/html';
      }

      // Create download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`Report exported as ${exportFormat.toUpperCase()}`, 'success');
    } catch (error) {
      console.error('Failed to export report:', error);
      showToast('Failed to export report', 'error');
    }
  };

  const printReport = () => {
    if (!report) return;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      showToast('Please allow pop-ups to print the report', 'error');
      return;
    }

    printWindow.document.write(exportYearEndReportToHTML(report));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  return (
    <div className="modal-overlay">
      <div className="year-end-reports-modal">
        <div className="modal-header">
          <h2>Year-End Reports</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="report-controls">
            <div className="year-selector">
              <label htmlFor="year-select">Select Year:</label>
              <select
                id="year-select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                disabled={loading}
              >
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            <button
              className="generate-button"
              onClick={generateReport}
              disabled={loading}
            >
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>

          {report && (
            <div className="report-content">
              <div className="report-header">
                <h3>Year {report.year} Summary</h3>
                <div className="export-controls">
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as 'csv' | 'html')}
                  >
                    <option value="html">HTML</option>
                    <option value="csv">CSV</option>
                  </select>
                  <button onClick={exportReport}>Export</button>
                  <button onClick={printReport}>Print</button>
                </div>
              </div>

              <div className="summary-grid">
                <div className="metric-card">
                  <div className="metric-value">{formatCurrency(report.summary.totalDoorFees)}</div>
                  <div className="metric-label">Total Door Fees</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{formatCurrency(report.summary.totalRefunds)}</div>
                  <div className="metric-label">Total Refunds</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{formatCurrency(report.summary.netRevenue)}</div>
                  <div className="metric-label">Net Revenue</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{report.summary.totalCheckIns}</div>
                  <div className="metric-label">Total Check-ins</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{report.summary.uniquePlayers}</div>
                  <div className="metric-label">Unique Players</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{formatCurrency(report.summary.averageDoorFee)}</div>
                  <div className="metric-label">Average Door Fee</div>
                </div>
              </div>

              <div className="report-section">
                <h4>Monthly Breakdown</h4>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Door Fees</th>
                        <th>Refunds</th>
                        <th>Net Revenue</th>
                        <th>Check-ins</th>
                        <th>Refunds</th>
                        <th>Unique Players</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.monthlyBreakdown.map((month, index) => (
                        <tr key={index}>
                          <td>{month.month}</td>
                          <td>{formatCurrency(month.doorFees)}</td>
                          <td>{formatCurrency(month.refunds)}</td>
                          <td>{formatCurrency(month.netRevenue)}</td>
                          <td>{month.checkIns}</td>
                          <td>{month.refundsCount}</td>
                          <td>{month.uniquePlayers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="report-section">
                <h4>Top 20 Players (by total spent)</h4>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Name</th>
                        <th>Check-ins</th>
                        <th>Total Spent</th>
                        <th>Average Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topPlayers.map((player, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{player.name}</td>
                          <td>{player.checkIns}</td>
                          <td>{formatCurrency(player.totalSpent)}</td>
                          <td>{formatCurrency(player.averageFee)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="report-section">
                <h4>Payment Methods</h4>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Count</th>
                        <th>Total</th>
                        <th>Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.paymentMethods.map((method, index) => (
                        <tr key={index}>
                          <td>{method.method}</td>
                          <td>{method.count}</td>
                          <td>{formatCurrency(method.total)}</td>
                          <td>{method.percentage.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-footer-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
