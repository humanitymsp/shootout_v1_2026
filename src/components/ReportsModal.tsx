import { useState } from 'react';
import { getClubDayReport, getShiftReport, getEndOfShiftReport, resetClubDay } from '../lib/api';
import { showToast } from './Toast';
import { format } from 'date-fns';
import YearEndReportsModal from './YearEndReportsModal';
import './ReportsModal.css';

interface ReportsModalProps {
  clubDayId: string;
  onClose: () => void;
  onDayReset?: () => void;
  adminUser?: string;
}

export default function ReportsModal({ clubDayId, onClose, onDayReset, adminUser }: ReportsModalProps) {
  const [reportType, setReportType] = useState<'current' | 'range' | 'shift' | 'yearEnd'>('shift');
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endTime, setEndTime] = useState('23:59');
  // Shift report defaults: shift start = 6 hours ago, shift end = now
  const [shiftStartDate, setShiftStartDate] = useState(format(new Date(Date.now() - 6 * 60 * 60 * 1000), "yyyy-MM-dd"));
  const [shiftStartTime, setShiftStartTime] = useState(format(new Date(Date.now() - 6 * 60 * 60 * 1000), "HH:mm"));
  const [shiftEndDate, setShiftEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [shiftEndTime, setShiftEndTime] = useState(format(new Date(), "HH:mm"));
  const [loading, setLoading] = useState(false);
  const [eodReportGenerated, setEodReportGenerated] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [exportFormat, setExportFormat] = useState<'print' | 'csv'>('print');
  const [showYearEndReports, setShowYearEndReports] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const handleGenerate = async () => {
    setLoading(true);
    try {
      let data;
      if (reportType === 'range') {
        const start = new Date(`${startDate}T${startTime}`).toISOString();
        const end = new Date(`${endDate}T${endTime}`).toISOString();
        data = await getShiftReport(start, end);
        if (exportFormat === 'csv') {
          handleExportCSV(data, 'range');
        } else {
          handlePrint(data, 'range');
        }
      } else if (reportType === 'shift') {
        const start = new Date(`${shiftStartDate}T${shiftStartTime}`).toISOString();
        const end = new Date(`${shiftEndDate}T${shiftEndTime}`).toISOString();
        data = await getEndOfShiftReport(start, end);
        if (exportFormat === 'csv') {
          handleExportCSV(data, 'shift');
        } else {
          handleShiftPrint(data);
        }
      } else if (reportType === 'yearEnd') {
        setShowYearEndReports(true);
      } else {
        data = await getClubDayReport(clubDayId);
        if (exportFormat === 'csv') {
          handleExportCSV(data, 'current');
        } else {
          handlePrint(data, 'current');
          setEodReportGenerated(true);
        }
      }
    } catch (error: any) {
      console.error('Error generating report:', error);
      alert(error.message || 'Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = (reportData: any, reportType: string) => {
    try {
      let csvContent = '';
      let filename = '';
      
      // Generate filename based on report type and date
      const now = new Date();
      const dateStr = format(now, 'yyyy-MM-dd');
      const timeStr = format(now, 'HH-mm-ss');
      
      if (reportType === 'current') {
        filename = `club-day-report-${dateStr}-${timeStr}.csv`;
        csvContent = generateClubDayCSV(reportData);
      } else if (reportType === 'shift') {
        filename = `shift-report-${dateStr}-${timeStr}.csv`;
        csvContent = generateShiftCSV(reportData);
      } else {
        filename = `custom-report-${dateStr}-${timeStr}.csv`;
        csvContent = generateShiftCSV(reportData); // Range reports use same format as shift
      }
      
      // Create and download CSV file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      showToast('Report exported to CSV successfully', 'success');
    } catch (error) {
      console.error('Error exporting CSV:', error);
      showToast('Failed to export CSV', 'error');
    }
  };

  const generateClubDayCSV = (data: any): string => {
    const lines: string[] = [];
    
    // Header
    lines.push('Final Table Poker Club - Club Day Report');
    lines.push(`Generated: ${format(new Date(), 'PPP p')}`);
    lines.push('');
    
    // Summary
    lines.push('SUMMARY');
    lines.push('Metric,Value');
    lines.push(`Total Check-ins,${data.checkin_count || 0}`);
    lines.push(`Active Check-ins,${data.active_checkin_count || 0}`);
    lines.push(`Total Door Fees,$${(data.total_door_fees || 0).toFixed(2)}`);
    lines.push(`Total Refunds,$${(data.total_refunds || 0).toFixed(2)}`);
    lines.push(`Net Total,$${(data.net_total || 0).toFixed(2)}`);
    lines.push(`Refund Count,${data.refund_count || 0}`);
    lines.push('');
    
    // Check-ins
    if (data.checkedInNames && data.checkedInNames.length > 0) {
      lines.push('CHECK-INS');
      lines.push('Name,Amount,Time');
      data.checkedInNames.forEach((checkin: any) => {
        const time = checkin.time ? format(new Date(checkin.time), 'h:mm a') : '';
        lines.push(`"${checkin.name}",$${checkin.amount.toFixed(2)},${time}`);
      });
      lines.push('');
    }
    
    // Refunds
    if (data.refundedNames && data.refundedNames.length > 0) {
      lines.push('REFUNDS');
      lines.push('Name,Amount,Reason');
      data.refundedNames.forEach((refund: any) => {
        lines.push(`"${refund.name}",$${refund.amount.toFixed(2)},"${refund.reason}"`);
      });
      lines.push('');
    }
    
    return lines.join('\n');
  };

  const generateShiftCSV = (data: any): string => {
    const lines: string[] = [];
    
    // Header
    lines.push('Final Table Poker Club - Shift Report');
    if (data.shiftStart) {
      lines.push(`Shift: ${format(new Date(data.shiftStart), 'MMM d, yyyy h:mm a')} - ${format(new Date(data.shiftEnd), 'MMM d, yyyy h:mm a')}`);
    }
    lines.push(`Generated: ${format(new Date(), 'PPP p')}`);
    lines.push('');
    
    // Summary
    lines.push('SUMMARY');
    lines.push('Metric,Value');
    lines.push(`Total Check-ins,${data.checkin_count || 0}`);
    lines.push(`Active Check-ins,${data.active_checkin_count || 0}`);
    lines.push(`Total Door Fees,$${(data.total_door_fees || 0).toFixed(2)}`);
    lines.push(`Total Refunds,$${(data.total_refunds || 0).toFixed(2)}`);
    lines.push(`Net Total,$${(data.net_total || 0).toFixed(2)}`);
    lines.push(`Refund Count,${data.refund_count || 0}`);
    lines.push('');
    
    // Check-ins (all including refunded for complete history)
    if (data.checkedInNames && data.checkedInNames.length > 0) {
      lines.push('ALL CHECK-INS');
      lines.push('Name,Amount,Time');
      data.checkedInNames.forEach((checkin: any) => {
        const time = checkin.time ? format(new Date(checkin.time), 'h:mm a') : '';
        lines.push(`"${checkin.name}",$${checkin.amount.toFixed(2)},${time}`);
      });
      lines.push('');
    }
    
    // Refunds
    if (data.refundedNames && data.refundedNames.length > 0) {
      lines.push('REFUNDS');
      lines.push('Name,Amount,Reason');
      data.refundedNames.forEach((refund: any) => {
        lines.push(`"${refund.name}",$${refund.amount.toFixed(2)},"${refund.reason}"`);
      });
      lines.push('');
    }
    
    return lines.join('\n');
  };

  const handleEodReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }

    setResetting(true);
    try {
      await resetClubDay(adminUser || 'admin');
      showToast('Day closed and reset successfully. New club day created.', 'success');
      
      // Clear stale notification state
      localStorage.removeItem('new-day-notification-dismissed');
      
      // Broadcast update
      try {
        const channel = new BroadcastChannel('admin-updates');
        channel.postMessage({ type: 'table-update', action: 'day-reset' });
        channel.close();
      } catch (_) { /* ignore */ }
      localStorage.setItem('table-updated', new Date().toISOString());
      localStorage.setItem('player-updated', new Date().toISOString());

      onClose();
      if (onDayReset) onDayReset();
    } catch (error: any) {
      showToast(error.message || 'Failed to reset day', 'error');
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  const handleShiftPrint = (reportData: any) => {
    const printWindow = window.open('', '_blank', 'width=600,height=700');
    if (!printWindow) {
      alert('Please allow pop-ups to view the report');
      return;
    }

    const now = new Date();
    const reportDate = format(now, 'MMM d, yyyy');
    const reportTime = format(now, 'h:mm:ss a');
    const shiftFrom = format(new Date(`${shiftStartDate}T${shiftStartTime}`), 'MMM d, yyyy h:mm a');
    const shiftTo = format(new Date(`${shiftEndDate}T${shiftEndTime}`), 'MMM d, yyyy h:mm a');

    const totalCheckIns = reportData.checkin_count || 0;
    const activeCheckIns = reportData.active_checkin_count ?? totalCheckIns;
    const doorFees = parseFloat(reportData.total_door_fees) || 0;
    const totalRefunds = parseFloat(reportData.total_refunds) || 0;
    const refundCount = reportData.refund_count || 0;
    const netTotal = parseFloat(reportData.net_total) || (doorFees - totalRefunds);
    const checkedInNames: { name: string; amount: number; time?: string }[] = reportData.checkedInNames || [];
    const refundedNames: { name: string; amount: number; reason: string }[] = reportData.refundedNames || [];

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>END OF SHIFT REPORT</title>
          <style>
            @media print {
              @page { size: 80mm auto; margin: 0; }
              .print-actions { display: none; }
              body { margin: 0; padding: 0; }
            }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Courier New', monospace;
              font-size: 11pt;
              line-height: 1.2;
              padding: 5mm;
              background: white;
              color: #000;
              width: 80mm;
            }
            .report-container { width: 100%; max-width: 80mm; margin: 0 auto; }
            .print-actions {
              text-align: center;
              margin-bottom: 15px;
              padding-bottom: 15px;
              border-bottom: 1px solid #ddd;
            }
            .print-button, .close-button {
              background: #4f46e5; color: white; border: none;
              padding: 10px 20px; font-size: 14px; font-weight: 600;
              border-radius: 4px; cursor: pointer; margin: 5px;
            }
            .close-button { background: #6b7280; }
            .report-header {
              text-align: center; margin-bottom: 8px;
              padding-bottom: 8px; border-bottom: 1px solid #000;
            }
            .company-name { font-size: 14pt; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px; }
            .report-title { font-size: 12pt; font-weight: bold; margin: 4px 0; text-transform: uppercase; }
            .report-date { font-size: 9pt; margin: 2px 0; }
            .report-period { font-size: 9pt; margin: 4px 0; font-weight: bold; }
            .shift-badge {
              display: inline-block; background: #1a3a5c; color: #7dd3fc;
              font-size: 8pt; font-weight: bold; padding: 2px 6px;
              border-radius: 3px; margin-top: 4px; letter-spacing: 0.5px;
            }
            .separator { border-top: 1px dashed #000; margin: 6px 0; }
            .separator-thick { border-top: 2px solid #000; margin: 8px 0; }
            .report-section { margin: 8px 0; }
            .report-row {
              display: flex; justify-content: space-between;
              margin: 4px 0; font-size: 10pt;
            }
            .report-row-label { text-align: left; flex: 1; }
            .report-row-value { text-align: right; min-width: 60px; }
            .report-row-value.currency { font-weight: bold; }
            .report-row-net {
              display: flex; justify-content: space-between;
              margin: 8px 0; padding: 6px 0; font-size: 12pt; font-weight: bold;
              border-top: 2px solid #000; border-bottom: 2px solid #000;
              text-transform: uppercase;
            }
            .report-footer {
              margin-top: 12px; padding-top: 8px;
              border-top: 1px dashed #000; text-align: center; font-size: 8pt;
            }
            .no-reset-notice {
              text-align: center; font-size: 8pt; font-style: italic;
              color: #555; margin: 6px 0; padding: 4px;
              border: 1px dashed #aaa; border-radius: 3px;
            }
            .player-list-section { margin: 8px 0; }
            .player-list-title {
              font-size: 9pt; font-weight: bold; text-transform: uppercase;
              letter-spacing: 0.5px; margin-bottom: 4px;
              border-bottom: 1px solid #000; padding-bottom: 2px;
            }
            .player-list-item {
              display: flex; justify-content: space-between;
              font-size: 9pt; margin: 2px 0; padding: 1px 0;
            }
            .player-list-item:nth-child(even) { background: #f5f5f5; }
            .player-name {
              flex: 1; overflow: hidden; text-overflow: ellipsis;
              white-space: nowrap; padding-right: 4px;
            }
            .player-time { font-size: 8pt; color: #555; white-space: nowrap; padding-right: 4px; }
            .player-amount { font-weight: bold; white-space: nowrap; }
            .player-reason { font-size: 8pt; color: #555; font-style: italic; padding-left: 8px; }
          </style>
        </head>
        <body>
          <div class="report-container">
            <div class="print-actions">
              <button class="print-button" onclick="window.print()">Print Report</button>
              <button class="close-button" onclick="window.close()">Close</button>
            </div>
            <div class="report-header">
              <div class="company-name">FINAL TABLE POKER CLUB</div>
              <div class="report-title">END OF SHIFT REPORT</div>
              <div class="report-date">Generated: ${reportDate} at ${reportTime}</div>
              <div class="report-period">Shift: ${shiftFrom}</div>
              <div class="report-period">    to: ${shiftTo}</div>
              <div><span class="shift-badge">SHIFT ONLY &mdash; DAY NOT CLOSED</span></div>
            </div>

            <div class="separator-thick"></div>

            <div class="report-section">
              <div class="report-row">
                <span class="report-row-label">Check-ins This Shift:</span>
                <span class="report-row-value">${totalCheckIns}</span>
              </div>
              ${refundCount > 0 ? `
              <div class="report-row">
                <span class="report-row-label">Active (after refunds):</span>
                <span class="report-row-value">${activeCheckIns}</span>
              </div>` : ''}
              <div class="report-row">
                <span class="report-row-label">Refunds This Shift:</span>
                <span class="report-row-value">${refundCount}</span>
              </div>
            </div>

            <div class="separator"></div>

            <div class="report-section">
              <div class="report-row">
                <span class="report-row-label">Buy-ins Collected:</span>
                <span class="report-row-value currency">$${doorFees.toFixed(2)}</span>
              </div>
              <div class="report-row">
                <span class="report-row-label">Refunds Issued:</span>
                <span class="report-row-value currency">$${totalRefunds.toFixed(2)}</span>
              </div>
            </div>

            <div class="separator-thick"></div>

            <div class="report-row-net">
              <span>Shift Net:</span>
              <span>$${netTotal.toFixed(2)}</span>
            </div>

            <div class="separator-thick"></div>

            ${checkedInNames.length > 0 ? `
            <div class="player-list-section">
              <div class="player-list-title">Buy-ins This Shift (${checkedInNames.length})</div>
              ${checkedInNames.map((p, i) => `
              <div class="player-list-item">
                <span class="player-name">${i + 1}. ${p.name}</span>
                ${p.time ? `<span class="player-time">${format(new Date(p.time), 'h:mm a')}</span>` : ''}
                <span class="player-amount">$${p.amount.toFixed(2)}</span>
              </div>`).join('')}
            </div>
            <div class="separator"></div>
            ` : ''}

            ${refundedNames.length > 0 ? `
            <div class="player-list-section">
              <div class="player-list-title">Refunds This Shift (${refundedNames.length})</div>
              ${refundedNames.map((p, i) => `
              <div class="player-list-item" style="flex-direction:column;">
                <div style="display:flex;justify-content:space-between;">
                  <span class="player-name">${i + 1}. ${p.name}</span>
                  <span class="player-amount">-$${p.amount.toFixed(2)}</span>
                </div>
                ${p.reason ? `<div class="player-reason">${p.reason}</div>` : ''}
              </div>`).join('')}
            </div>
            <div class="separator"></div>
            ` : ''}

            <div class="separator-thick"></div>

            <div class="no-reset-notice">Day remains open &mdash; shift report only</div>

            <div class="report-footer">
              <div>--- End of Shift Report ---</div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handlePrint = (reportData: any, reportType: 'current' | 'range' = 'current') => {
    // Create a new window to display the report
    const printWindow = window.open('', '_blank', 'width=600,height=700');
    if (!printWindow) {
      alert('Please allow pop-ups to view the report');
      return;
    }

    const reportTitle = 'END OF DAY REPORT';
    const now = new Date();
    const reportDate = format(now, 'MMM d, yyyy');
    const reportTime = format(now, 'h:mm:ss a');
    const dateRange = reportType === 'range' 
      ? `${format(new Date(`${startDate}T${startTime}`), 'MMM d, yyyy h:mm a')} - ${format(new Date(`${endDate}T${endTime}`), 'MMM d, yyyy h:mm a')}`
      : '';
    
    const totalCheckIns = reportData.checkin_count || 0;
    const activeCheckIns = reportData.active_checkin_count ?? totalCheckIns;
    const doorFees = parseFloat(reportData.total_door_fees) || 0;
    const totalRefunds = parseFloat(reportData.total_refunds) || 0;
    const refundCount = reportData.refund_count || 0;
    // Use server-computed net_total to avoid client-side rounding discrepancies
    const netTotal = parseFloat(reportData.net_total) || (doorFees - totalRefunds);
    const checkedInNames: { name: string; amount: number }[] = reportData.checkedInNames || [];
    const refundedNames: { name: string; amount: number; reason: string }[] = reportData.refundedNames || [];

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @media print {
              @page {
                size: 80mm auto;
                margin: 0;
              }
              .print-actions {
                display: none;
              }
              body {
                margin: 0;
                padding: 0;
              }
            }
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Courier New', monospace;
              font-size: 11pt;
              line-height: 1.2;
              padding: 5mm;
              margin: 0;
              background: white;
              color: #000;
              width: 80mm;
            }
            .report-container {
              width: 100%;
              max-width: 80mm;
              margin: 0 auto;
              background: white;
            }
            .print-actions {
              text-align: center;
              margin-bottom: 15px;
              padding-bottom: 15px;
              border-bottom: 1px solid #ddd;
            }
            .print-button, .close-button {
              background: #4f46e5;
              color: white;
              border: none;
              padding: 10px 20px;
              font-size: 14px;
              font-weight: 600;
              border-radius: 4px;
              cursor: pointer;
              margin: 5px;
            }
            .close-button {
              background: #6b7280;
            }
            .report-header {
              text-align: center;
              margin-bottom: 8px;
              padding-bottom: 8px;
              border-bottom: 1px solid #000;
            }
            .company-name {
              font-size: 14pt;
              font-weight: bold;
              letter-spacing: 1px;
              margin-bottom: 4px;
            }
            .report-title {
              font-size: 12pt;
              font-weight: bold;
              margin: 4px 0;
              text-transform: uppercase;
            }
            .report-date {
              font-size: 9pt;
              margin: 2px 0;
            }
            .report-period {
              font-size: 9pt;
              margin: 4px 0;
              font-weight: bold;
            }
            .separator {
              border-top: 1px dashed #000;
              margin: 6px 0;
            }
            .separator-thick {
              border-top: 2px solid #000;
              margin: 8px 0;
            }
            .report-section {
              margin: 8px 0;
            }
            .report-row {
              display: flex;
              justify-content: space-between;
              margin: 4px 0;
              font-size: 10pt;
            }
            .report-row-label {
              text-align: left;
              flex: 1;
            }
            .report-row-value {
              text-align: right;
              font-weight: normal;
              min-width: 60px;
            }
            .report-row-value.currency {
              font-weight: bold;
            }
            .report-row-total {
              display: flex;
              justify-content: space-between;
              margin: 6px 0;
              padding: 4px 0;
              font-size: 11pt;
              font-weight: bold;
              border-top: 1px solid #000;
              border-bottom: 1px solid #000;
            }
            .report-row-net {
              display: flex;
              justify-content: space-between;
              margin: 8px 0;
              padding: 6px 0;
              font-size: 12pt;
              font-weight: bold;
              border-top: 2px solid #000;
              border-bottom: 2px solid #000;
              text-transform: uppercase;
            }
            .report-footer {
              margin-top: 12px;
              padding-top: 8px;
              border-top: 1px dashed #000;
              text-align: center;
              font-size: 8pt;
            }
            .spacer {
              height: 4px;
            }
            .player-list-section {
              margin: 8px 0;
            }
            .player-list-title {
              font-size: 9pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 4px;
              border-bottom: 1px solid #000;
              padding-bottom: 2px;
            }
            .player-list-item {
              display: flex;
              justify-content: space-between;
              font-size: 9pt;
              margin: 2px 0;
              padding: 1px 0;
            }
            .player-list-item:nth-child(even) {
              background: #f5f5f5;
            }
            .player-name {
              flex: 1;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              padding-right: 4px;
            }
            .player-amount {
              font-weight: bold;
              white-space: nowrap;
            }
            .player-reason {
              font-size: 8pt;
              color: #555;
              font-style: italic;
              padding-left: 8px;
            }
          </style>
        </head>
        <body>
          <div class="report-container">
            <div class="print-actions">
              <button class="print-button" onclick="window.print()">Print Report</button>
              <button class="close-button" onclick="window.close()">Close</button>
            </div>
            <div class="report-header">
              <div class="company-name">FINAL TABLE POKER CLUB</div>
              <div class="report-title">${reportTitle}</div>
              <div class="report-date">Generated: ${reportDate} at ${reportTime}</div>
              ${dateRange ? `<div class="report-period">Period: ${dateRange}</div>` : `<div class="report-period">Date: ${reportDate}</div>`}
            </div>
            
            <div class="separator-thick"></div>
            
            <div class="report-section">
              <div class="report-row">
                <span class="report-row-label">Total Check-ins:</span>
                <span class="report-row-value">${totalCheckIns}</span>
              </div>
              ${refundCount > 0 ? `
              <div class="report-row">
                <span class="report-row-label">Active (after refunds):</span>
                <span class="report-row-value">${activeCheckIns}</span>
              </div>` : ''}
              <div class="report-row">
                <span class="report-row-label">Refund Count:</span>
                <span class="report-row-value">${refundCount}</span>
              </div>
            </div>
            
            <div class="separator"></div>
            
            <div class="report-section">
              <div class="report-row">
                <span class="report-row-label">Door Fees Collected:</span>
                <span class="report-row-value currency">$${doorFees.toFixed(2)}</span>
              </div>
              <div class="report-row">
                <span class="report-row-label">Total Refunds:</span>
                <span class="report-row-value currency">$${totalRefunds.toFixed(2)}</span>
              </div>
            </div>
            
            <div class="separator-thick"></div>
            
            <div class="report-row-net">
              <span>Net Total:</span>
              <span>$${netTotal.toFixed(2)}</span>
            </div>
            
            <div class="separator-thick"></div>

            ${checkedInNames.length > 0 ? `
            <div class="player-list-section">
              <div class="player-list-title">Checked-In Players (${checkedInNames.length})</div>
              ${checkedInNames.map((p, i) => `
              <div class="player-list-item">
                <span class="player-name">${i + 1}. ${p.name}</span>
                <span class="player-amount">$${p.amount.toFixed(2)}</span>
              </div>`).join('')}
            </div>
            <div class="separator"></div>
            ` : ''}

            ${refundedNames.length > 0 ? `
            <div class="player-list-section">
              <div class="player-list-title">Refunded Players (${refundedNames.length})</div>
              ${refundedNames.map((p, i) => `
              <div class="player-list-item" style="flex-direction:column;">
                <div style="display:flex;justify-content:space-between;">
                  <span class="player-name">${i + 1}. ${p.name}</span>
                  <span class="player-amount">-$${p.amount.toFixed(2)}</span>
                </div>
                ${p.reason ? `<div class="player-reason">${p.reason}</div>` : ''}
              </div>`).join('')}
            </div>
            <div class="separator"></div>
            ` : ''}

            <div class="separator-thick"></div>
            
            <div class="report-footer">
              <div>--- End of Report ---</div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content reports-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Reports</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="report-type-selector">
            <label>
              <input
                type="radio"
                name="reportType"
                value="current"
                checked={reportType === 'current'}
                onChange={() => setReportType('current')}
              />
              Current Club Day
            </label>
            <label>
              <input
                type="radio"
                name="reportType"
                value="shift"
                checked={reportType === 'shift'}
                onChange={() => setReportType('shift')}
              />
              End of Shift
            </label>
            <label>
              <input
                type="radio"
                name="reportType"
                value="range"
                checked={reportType === 'range'}
                onChange={() => setReportType('range')}
              />
              Date Range
            </label>
            <label>
              <input
                type="radio"
                name="reportType"
                value="yearEnd"
                checked={reportType === 'yearEnd'}
                onChange={() => setReportType('yearEnd')}
              />
              Year-End Report
            </label>
          </div>

          {reportType === 'shift' && (
            <div className="shift-report-section">
              <div className="shift-report-notice">
                Generates a buy-in and refund summary for the selected shift window.
                <strong> The day stays open — no reset is performed.</strong>
              </div>
              <div className="date-range-selector">
                <div className="form-group">
                  <label>Shift Start Date</label>
                  <input
                    type="date"
                    value={shiftStartDate}
                    onChange={(e) => setShiftStartDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Shift Start Time</label>
                  <input
                    type="time"
                    value={shiftStartTime}
                    onChange={(e) => setShiftStartTime(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Shift End Date</label>
                  <input
                    type="date"
                    value={shiftEndDate}
                    onChange={(e) => setShiftEndDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Shift End Time</label>
                  <input
                    type="time"
                    value={shiftEndTime}
                    onChange={(e) => setShiftEndTime(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {reportType === 'range' && (
            <div className="date-range-selector">
              <div className="form-group">
                <label>Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="report-info">
            {reportType === 'shift' ? (
              <>
                <p>Generates a shift summary for the selected time window within the current club day.</p>
                <p className="report-summary">The report includes:</p>
                <ul>
                  <li>Buy-ins collected during the shift</li>
                  <li>Refunds issued during the shift</li>
                  <li>Net shift total</li>
                  <li>Per-player buy-in list with times</li>
                </ul>
              </>
            ) : reportType === 'yearEnd' ? (
              <>
                <p>Generate comprehensive year-end reports for financial analysis and tax reporting.</p>
                <p className="report-summary">The report includes:</p>
                <ul>
                  <li>Complete yearly financial summary</li>
                  <li>Monthly breakdowns and trends</li>
                  <li>Top players by spending</li>
                  <li>Payment method analysis</li>
                  <li>Export to HTML or CSV formats</li>
                </ul>
              </>
            ) : (
              <>
                <p>Generate the Club {reportType === 'current' ? 'End of Day Report for the current club day' : 'Report for the selected date range'}.</p>
                <p className="report-summary">The report includes:</p>
                <ul>
                  <li>Total Check-ins</li>
                  <li>Door Fees Collected</li>
                  <li>Total Refunds</li>
                  <li>Refund Count</li>
                </ul>
              </>
            )}
          </div>
          <div className="modal-actions">
            <div className="export-controls">
              <label htmlFor="export-format">Export Format:</label>
              <select
                id="export-format"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'print' | 'csv')}
                disabled={loading || resetting}
              >
                <option value="print">Print</option>
                <option value="csv">CSV</option>
              </select>
            </div>
            <div className="action-buttons">
              <button type="button" onClick={onClose} disabled={loading || resetting}>
                Close
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || resetting}
                className={reportType === 'shift' ? 'btn-shift-report' : reportType === 'current' ? 'btn-generate-report' : undefined}
              >
                {loading ? 'Generating...' : reportType === 'yearEnd' ? 'Open Year-End Reports' : exportFormat === 'csv' ? 'Export CSV' : (reportType === 'shift' ? 'Generate Shift Report' : 'Generate Report')}
              </button>
            </div>
          </div>

          {/* End of Day — Close & Reset Section (only for full-day report, never for shift) */}
          {onDayReset && reportType === 'current' && (
            <div className="eod-reset-section">
              <div className="eod-reset-header">
                <h3>⚠️ End of Day — Close &amp; Reset</h3>
                <div className="eod-flow-notice">
                  <div className="eod-flow-step">
                    <span className="eod-flow-num">1</span>
                    <span>Click <strong>"Generate Report"</strong> above — EOD report prints automatically</span>
                  </div>
                  <div className="eod-flow-arrow">↓</div>
                  <div className="eod-flow-step">
                    <span className="eod-flow-num">2</span>
                    <span>Click <strong>"Close Day &amp; Start New Day"</strong> below — day closes and new day begins</span>
                  </div>
                </div>
              </div>
              {eodReportGenerated && (
                <p className="eod-report-note">✅ EOD report generated — ready to close day.</p>
              )}
              {!confirmReset ? (
                <button
                  type="button"
                  className={`eod-reset-btn${eodReportGenerated ? ' ready' : ''}`}
                  onClick={handleEodReset}
                  disabled={resetting}
                >
                  Close Day &amp; Start New Day
                </button>
              ) : (
                <div className="eod-confirm">
                  <p className="eod-confirm-text">
                    ⚠️ This will close the current club day, clear all seated/waitlisted players, and create a new day with default tables. <strong>This cannot be undone.</strong>
                  </p>
                  <div className="eod-confirm-actions">
                    <button
                      type="button"
                      className="eod-confirm-cancel"
                      onClick={() => setConfirmReset(false)}
                      disabled={resetting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="eod-confirm-btn"
                      onClick={handleEodReset}
                      disabled={resetting}
                    >
                      {resetting ? 'Resetting...' : 'Yes, Close Day & Reset'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {showYearEndReports && (
        <YearEndReportsModal
          onClose={() => setShowYearEndReports(false)}
        />
      )}
    </div>
  );
}
